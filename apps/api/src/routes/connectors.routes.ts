import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard, requireRole } from "../plugins/auth";
import crypto from "crypto";
import { encryptToken } from "../utils/crypto";
import { testQueue as queue } from "../queue";

export const connectorsRoutes: FastifyPluginAsync = async (app) => {
    // We register authGuard for most routes, but the callback might be hit directly by Shopify.
    // However, the callback uses the `state` parameter to identify the tenant and domain, 
    // so we can make it public or handle auth carefully. Wait, the prompt says for callback: 
    // "validar query: shop, code, state, hmac, validar state existe e não expirou e pertence ao tenant".
    // So callback is PUBLIC, no authGuard! 

    // Public Callback
    app.get("/shopify/callback", async (request, reply) => {
        const querySchema = z.object({
            shop: z.string(),
            code: z.string(),
            state: z.string(),
            hmac: z.string()
        }).passthrough();

        const query = querySchema.parse(request.query);
        const { shop, code, state, hmac } = query;

        // 1. Verify HMAC
        const secret = process.env.SHOPIFY_API_SECRET;
        if (!secret) throw new Error("Missing SHOPIFY_API_SECRET");

        const qMap = new URLSearchParams(request.query as Record<string, string>);
        qMap.delete("hmac");
        // sort query params
        const sortedMap = Array.from(qMap.entries()).sort(([a], [b]) => a.localeCompare(b));
        const message = sortedMap.map(([k, v]) => `${k}=${v}`).join('&');
        const generatedHash = crypto.createHmac('sha256', secret).update(message).digest('hex');

        if (generatedHash !== hmac) {
            return reply.status(403).send({ error: "HMAC validation failed" });
        }

        // 2. Validate State
        const oauthState = await (prisma as any).oauthState.findUnique({
            where: { state }
        });

        if (!oauthState) {
            return reply.status(400).send({ error: "Invalid or expired state" });
        }

        if (new Date() > oauthState.expires_at) {
            await (prisma as any).oauthState.delete({ where: { id: oauthState.id } });
            return reply.status(400).send({ error: "State expired" });
        }

        // 3. Exchange code for access token
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: process.env.SHOPIFY_API_KEY,
                client_secret: process.env.SHOPIFY_API_SECRET,
                code
            })
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            app.log.error(`Shopify Token Error: ${err}`);
            return reply.status(500).send({ error: "Failed to exchange token" });
        }

        const tokenData = await tokenRes.json();
        const { access_token, scope } = tokenData;

        // 4. Encrypt and Upsert Connector
        const encrypted = encryptToken(access_token);
        const name = `Shopify - ${shop}`;

        await (prisma as any).connector.upsert({
            where: {
                tenant_id_shop_domain: { tenant_id: oauthState.tenant_id, shop_domain: shop }
            },
            create: {
                tenant_id: oauthState.tenant_id,
                type: "shopify",
                name,
                shop_domain: shop,
                status: "connected",
                scopes: scope || process.env.SHOPIFY_SCOPES || "",
                access_token_enc: encrypted.enc,
                access_token_iv: encrypted.iv,
                access_token_tag: encrypted.tag,
                last_sync_at: null
            },
            update: {
                status: "connected",
                scopes: scope || process.env.SHOPIFY_SCOPES || "",
                access_token_enc: encrypted.enc,
                access_token_iv: encrypted.iv,
                access_token_tag: encrypted.tag,
                name
            }
        });

        // 5. Cleanup state and redirect
        await (prisma as any).oauthState.delete({ where: { id: oauthState.id } });

        const webUrl = process.env.APP_BASE_URL || "http://localhost:3000";
        return reply.redirect(`${webUrl}/app/connectors?shopify=connected`);
    });

    app.get("/meli/callback", async (request, reply) => {
        const querySchema = z.object({
            code: z.string(),
            state: z.string()
        }).passthrough();

        const query = querySchema.parse(request.query);
        const { code, state } = query;

        const oauthState = await (prisma as any).oauthState.findUnique({
            where: { state }
        });

        if (!oauthState || oauthState.provider !== "meli") {
            return reply.status(400).send({ error: "Invalid or expired state" });
        }

        if (new Date() > oauthState.expires_at) {
            await (prisma as any).oauthState.delete({ where: { id: oauthState.id } });
            return reply.status(400).send({ error: "State expired" });
        }

        const clientId = process.env.MELI_CLIENT_ID;
        const clientSecret = process.env.MELI_CLIENT_SECRET;
        const redirectUri = process.env.MELI_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new Error("Missing Meli Env Vars");
        }

        const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri
            }).toString()
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            app.log.error(`Meli Token Error: ${err}`);
            return reply.status(500).send({ error: "Failed to exchange token" });
        }

        const tokenData = await tokenRes.json();
        const { access_token, refresh_token, expires_in, user_id } = tokenData;

        const encAccess = encryptToken(access_token);
        const encRefresh = refresh_token ? encryptToken(refresh_token) : null;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        const metadata = oauthState.metadata as any || {};
        const site = metadata.site || "MLB";
        const name = `Mercado Livre - ${site} (${user_id})`;

        const configPayload = {
            user_id: user_id.toString(),
            country: site,
            access_token_enc: encAccess.enc,
            access_token_iv: encAccess.iv,
            access_token_tag: encAccess.tag,
            refresh_token_enc: encRefresh?.enc,
            refresh_token_iv: encRefresh?.iv,
            refresh_token_tag: encRefresh?.tag,
            expires_at: expiresAt.toISOString()
        };

        // Unique constraint is (tenant_id, shop_domain)
        // For Meli we use user_id as shop_domain to fit the constraint without breaking schema
        const pseudoDomain = `meli_${user_id}`;

        await (prisma as any).connector.upsert({
            where: {
                tenant_id_shop_domain: { tenant_id: oauthState.tenant_id, shop_domain: pseudoDomain }
            },
            create: {
                tenant_id: oauthState.tenant_id,
                type: "mercadolivre",
                name,
                shop_domain: pseudoDomain,
                status: "connected",
                scopes: "offline_access", // Generic
                access_token_enc: "using_config", // Deprecated direct col
                access_token_iv: "using_config",
                access_token_tag: "using_config",
                last_sync_at: null,
                config: configPayload
            },
            update: {
                status: "connected",
                name,
                config: configPayload
            }
        });

        await (prisma as any).oauthState.delete({ where: { id: oauthState.id } });

        const webUrl = process.env.APP_BASE_URL || "http://localhost:3000";
        return reply.redirect(`${webUrl}/app/connectors?meli=connected`);
    });


    // Authenticated Routes
    app.register(async (authApp) => {
        authApp.addHook("onRequest", authGuard);
        authApp.addHook("onRequest", tenantIsolationGuard);

        authApp.post("/shopify/install", async (request, reply) => {
            const schema = z.object({
                shopDomain: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/)
            });
            const { shopDomain } = schema.parse(request.body);
            const tenantId = request.auth!.tenantId!;

            const state = crypto.randomBytes(16).toString("hex");
            const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

            await (prisma as any).oauthState.create({
                data: {
                    tenant_id: tenantId,
                    shop_domain: shopDomain,
                    state,
                    expires_at
                }
            });

            const apiKey = process.env.SHOPIFY_API_KEY;
            const scopes = process.env.SHOPIFY_SCOPES;
            const callbackUrl = process.env.SHOPIFY_OAUTH_CALLBACK_URL;

            if (!apiKey || !scopes || !callbackUrl) {
                throw new Error("Missing Shopify Env Vars");
            }

            const redirectUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${callbackUrl}&state=${state}`;

            return reply.send({ redirectUrl });
        });

        authApp.post("/meli/install", async (request, reply) => {
            const schema = z.object({
                site: z.string().optional().default("MLB")
            });
            const { site } = schema.parse(request.body);
            const tenantId = request.auth!.tenantId!;

            const state = crypto.randomBytes(16).toString("hex");
            const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

            await (prisma as any).oauthState.create({
                data: {
                    tenant_id: tenantId,
                    provider: "meli",
                    state,
                    expires_at,
                    metadata: { site }
                }
            });

            const clientId = process.env.MELI_CLIENT_ID;
            const redirectUri = process.env.MELI_REDIRECT_URI;

            if (!clientId || !redirectUri) {
                throw new Error("Missing Meli Env Vars");
            }

            // auth domain depends on country, default MLB (Brazil)
            let authDomain = "auth.mercadolivre.com.br";
            if (site === "MLA") authDomain = "auth.mercadolibre.com.ar";
            else if (site === "MLM") authDomain = "auth.mercadolibre.com.mx";

            const redirectUrl = `https://${authDomain}/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}`;

            return reply.send({ redirectUrl });
        });

        authApp.post("/shopee/connect", async (request, reply) => {
            const schema = z.object({
                name: z.string().min(1).default("Shopee Store"),
                shopId: z.string().min(1),
                region: z.string().optional().default("BR"),
                accessToken: z.string().optional(),
                refreshToken: z.string().optional(),
                tokenExpiresAt: z.string().optional()
            });
            const { name, shopId, region, accessToken, refreshToken, tokenExpiresAt } = schema.parse(request.body);
            const tenantId = request.auth!.tenantId!;

            // Encrypt tokens if provided (Shopee v2 requires them for most endpoints)
            const encAccess = accessToken ? encryptToken(accessToken) : null;
            const encRefresh = refreshToken ? encryptToken(refreshToken) : null;

            const configPayload = {
                shop_id: shopId,
                region,
                access_token_enc: encAccess?.enc,
                access_token_iv: encAccess?.iv,
                access_token_tag: encAccess?.tag,
                refresh_token_enc: encRefresh?.enc,
                refresh_token_iv: encRefresh?.iv,
                refresh_token_tag: encRefresh?.tag,
                token_expires_at: tokenExpiresAt,
                // store API base to allow flexible region overrides if needed
                api_base: process.env.SHOPEE_API_BASE || "https://partner.shopeemobile.com"
            };

            const pseudoDomain = `shopee_${shopId}`;

            // Create or update the Shopee connector
            const connector = await (prisma as any).connector.upsert({
                where: {
                    tenant_id_shop_domain: { tenant_id: tenantId, shop_domain: pseudoDomain }
                },
                create: {
                    tenant_id: tenantId,
                    type: "shopee",
                    name,
                    shop_domain: pseudoDomain,
                    status: "connected",
                    scopes: "general", // MVP
                    access_token_enc: "using_config",
                    access_token_iv: "using_config",
                    access_token_tag: "using_config",
                    last_sync_at: null,
                    config: configPayload
                },
                update: {
                    status: "connected",
                    name,
                    config: configPayload
                }
            });

            // Note: A real "test connection" call could be placed here (e.g. get_shop_info).
            // For the MVP, if they provide the IDs, we assume it's connected and let the async sync job test it.

            return reply.send({ success: true, connectorId: connector.id });
        });

        authApp.get("/", async (request, reply) => {
            const tenantId = request.auth!.tenantId!;
            const connectors = await (prisma as any).connector.findMany({
                where: { tenant_id: tenantId },
                select: {
                    id: true,
                    type: true,
                    name: true,
                    status: true,
                    shop_domain: true,
                    last_sync_at: true,
                    last_error_at: true,
                    last_error: true,
                    created_at: true
                }
            });
            return reply.send(connectors);
        });

        authApp.post("/:id/sync", async (request, reply) => {
            // Only admin/owner should sync manually
            if (!["owner", "admin"].includes(request.auth!.role as string)) {
                return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
            }

            const tenantId = request.auth!.tenantId!;
            const connectorId = (request.params as any).id;

            const connector = await (prisma as any).connector.findUnique({
                where: { id: connectorId, tenant_id: tenantId }
            });

            if (!connector || !["shopify", "mercadolivre", "shopee"].includes(connector.type)) {
                return reply.status(404).send({ error: "Connector not found or unsupported" });
            }

            const syncEntityType = connector.type === "shopify" ? "shopify_sync" : connector.type === "mercadolivre" ? "meli_sync" : "shopee_sync";
            const jobName = syncEntityType; // They map 1:1 right now

            // Create ImportRun explicitly for sync
            const importRun = await prisma.importRun.create({
                data: {
                    tenant_id: tenantId,
                    connector_id: connector.id,
                    source: "api",
                    entity_type: syncEntityType,
                    status: "queued"
                }
            });

            await (prisma as any).connector.update({
                where: { id: connector.id },
                data: { status: "syncing" }
            });

            await queue.add(jobName, {
                tenantId,
                connectorId: connector.id,
                importRunId: importRun.id
            });

            return reply.send({ queued: true, importRunId: importRun.id });
        });

        authApp.get("/:id/sync/status", async (request, reply) => {
            const tenantId = request.auth!.tenantId!;
            const connectorId = (request.params as any).id;

            const connector = await (prisma as any).connector.findUnique({
                where: { id: connectorId, tenant_id: tenantId }
            });

            if (!connector) {
                return reply.status(404).send({ error: "Connector not found" });
            }

            const syncEntityType = connector.type === "shopify" ? "shopify_sync" : connector.type === "mercadolivre" ? "meli_sync" : "shopee_sync";

            const lastRun = await prisma.importRun.findFirst({
                where: { tenant_id: tenantId, connector_id: connectorId, entity_type: syncEntityType },
                orderBy: { created_at: "desc" },
                include: { errors: { take: 5, orderBy: { created_at: "desc" } } }
            });

            return reply.send(lastRun || null);
        });
    });
};

export default connectorsRoutes;

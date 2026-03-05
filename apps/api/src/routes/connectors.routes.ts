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

            if (!connector || connector.type !== "shopify") {
                return reply.status(404).send({ error: "Connector not found" });
            }

            // Create ImportRun explicitly for sync
            const importRun = await prisma.importRun.create({
                data: {
                    tenant_id: tenantId,
                    connector_id: connector.id,
                    source: "api",
                    entity_type: "shopify_sync",
                    status: "queued"
                }
            });

            await (prisma as any).connector.update({
                where: { id: connector.id },
                data: { status: "syncing" }
            });

            await queue.add("shopify_sync", {
                tenantId,
                connectorId: connector.id,
                importRunId: importRun.id
            });

            return reply.send({ queued: true, importRunId: importRun.id });
        });

        authApp.get("/:id/sync/status", async (request, reply) => {
            const tenantId = request.auth!.tenantId!;
            const connectorId = (request.params as any).id;

            const lastRun = await prisma.importRun.findFirst({
                where: { tenant_id: tenantId, connector_id: connectorId, entity_type: "shopify_sync" },
                orderBy: { created_at: "desc" },
                include: { errors: { take: 5, orderBy: { created_at: "desc" } } }
            });

            return reply.send(lastRun || null);
        });
    });
};

export default connectorsRoutes;

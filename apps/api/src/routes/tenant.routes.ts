import { FastifyInstance } from "fastify";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { logAudit } from "../utils/audit";
import { authGuard, getJwtSecret, tenantIsolationGuard, requireRole } from "../plugins/auth";
import { Role } from "shared";

const COOKIE_OPTIONS = {
    path: "/",
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60,
};

export default async function tenantRoutes(server: FastifyInstance) {
    // List all internal tenants for the user
    server.get("/tenants", { preHandler: [authGuard] }, async (request, reply) => {
        const userId = request.auth!.userId;

        const memberships = await prisma.membership.findMany({
            where: { user_id: userId },
            include: { tenant: true },
            orderBy: { created_at: "desc" },
        });

        return memberships.map((m) => ({
            id: m.tenant.id,
            name: m.tenant.name,
            slug: m.tenant.slug,
            role: m.role,
        }));
    });

    // Create a new tenant
    server.post("/tenants", { preHandler: [authGuard] }, async (request, reply) => {
        const schema = z.object({
            name: z.string().min(1),
        });

        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Invalid data", details: parsed.error.issues });
        }

        const { name } = parsed.data;
        const userId = request.auth!.userId;

        let baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
        let slug = baseSlug;
        let counter = 1;

        const result = await prisma.$transaction(async (tx) => {
            while (await tx.tenant.findUnique({ where: { slug } })) {
                slug = `${baseSlug}-${counter++}`;
            }

            const tenant = await tx.tenant.create({
                data: { name, slug },
            });

            const membership = await tx.membership.create({
                data: {
                    user_id: userId,
                    tenant_id: tenant.id,
                    role: "owner",
                },
            });

            return { tenant, role: membership.role as Role };
        });

        await logAudit({
            userId,
            tenantId: result.tenant.id,
            action: "create_tenant",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
        });

        // Optionally set this as active right away by minting a new token
        const token = jwt.sign(
            { userId, tenantId: result.tenant.id, role: result.role },
            getJwtSecret(),
            { expiresIn: "7d" }
        );

        reply.setCookie("token", token, COOKIE_OPTIONS);
        return { ok: true, tenant: result.tenant, role: result.role };
    });

    // Switch active tenant
    server.post("/tenants/select", { preHandler: [authGuard] }, async (request, reply) => {
        const schema = z.object({
            tenantId: z.string().uuid(),
        });

        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Invalid data" });
        }

        const { tenantId } = parsed.data;
        const userId = request.auth!.userId;

        const membership = await prisma.membership.findUnique({
            where: {
                tenant_id_user_id: {
                    tenant_id: tenantId,
                    user_id: userId,
                },
            },
            include: { tenant: true },
        });

        if (!membership) {
            return reply.status(403).send({ error: "Forbidden: Not a member of this tenant" });
        }

        const token = jwt.sign(
            { userId, tenantId: membership.tenant.id, role: membership.role as Role },
            getJwtSecret(),
            { expiresIn: "7d" }
        );

        await logAudit({
            userId,
            tenantId: membership.tenant.id,
            action: "select_tenant",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
        });

        reply.setCookie("token", token, COOKIE_OPTIONS);
        return { ok: true, activeTenant: membership.tenant.id, role: membership.role };
    });

    // Scope verification route
    server.get(
        "/tenant/scope-check",
        { preHandler: [authGuard, tenantIsolationGuard] },
        async (request, reply) => {
            // If we got here, request.auth.tenantId is guaranteed to exist
            return {
                tenantId: request.auth!.tenantId,
                ok: true,
                message: "You are securely isolated in this tenant scope.",
            };
        }
    );

    // Role verification test route (Admin+ only)
    server.get(
        "/tenant/admin-only",
        { preHandler: [authGuard, tenantIsolationGuard, requireRole(["owner", "admin"])] },
        async (request, reply) => {
            return { ok: true, message: "Welcome, Admin or Owner!" };
        }
    );
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { logAudit } from "../utils/audit";
import { authGuard, getJwtSecret } from "../plugins/auth";
import { Role } from "shared";

const COOKIE_OPTIONS = {
    path: "/",
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60, // 7 days
};

export default async function authRoutes(server: FastifyInstance) {
    server.post("/auth/signup", {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        }
    }, async (request, reply) => {
        const schema = z.object({
            email: z.string().email(),
            password: z.string().min(8),
            tenantName: z.string().optional(),
        });

        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Invalid data", details: parsed.error.issues });
        }

        const { email, password, tenantName } = parsed.data;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return reply.status(400).send({ error: "User already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password_hash: passwordHash,
                },
            });

            const finalTenantName = tenantName || `Owner of ${email}`;
            let baseSlug = finalTenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");

            // Basic slug unique handling
            let slug = baseSlug;
            let counter = 1;
            while (await tx.tenant.findUnique({ where: { slug } })) {
                slug = `${baseSlug}-${counter++}`;
            }

            const tenant = await tx.tenant.create({
                data: {
                    name: finalTenantName,
                    slug,
                },
            });

            await tx.membership.create({
                data: {
                    user_id: user.id,
                    tenant_id: tenant.id,
                    role: "owner",
                },
            });

            return { user, tenant, role: "owner" as Role };
        });

        await logAudit({
            userId: result.user.id,
            tenantId: result.tenant.id,
            action: "signup",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
        });

        const token = jwt.sign(
            { userId: result.user.id, tenantId: result.tenant.id, role: result.role },
            getJwtSecret(),
            { expiresIn: "7d" }
        );

        reply.setCookie("token", token, COOKIE_OPTIONS);
        return { ok: true };
    });

    server.post("/auth/login", {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute'
            }
        }
    }, async (request, reply) => {
        const schema = z.object({
            email: z.string().email(),
            password: z.string(),
        });

        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Invalid data" });
        }

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                memberships: {
                    include: { tenant: true },
                    orderBy: { created_at: "desc" },
                },
            },
        });

        if (!user) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { last_login_at: new Date() },
        });

        let activeTenantId = null;
        let activeRole = null;

        if (user.memberships.length > 0) {
            const activeMembership = user.memberships[0];
            activeTenantId = activeMembership.tenant_id;
            activeRole = activeMembership.role;
        }

        const token = jwt.sign(
            { userId: user.id, tenantId: activeTenantId, role: activeRole },
            getJwtSecret(),
            { expiresIn: "7d" }
        );

        await logAudit({
            userId: user.id,
            tenantId: activeTenantId,
            action: "login",
            ip: request.ip,
            userAgent: request.headers["user-agent"],
        });

        reply.setCookie("token", token, COOKIE_OPTIONS);
        return { ok: true, requireTenantSelection: user.memberships.length > 1 };
    });

    server.post("/auth/logout", { preHandler: [authGuard] }, async (request, reply) => {
        if (request.auth) {
            await logAudit({
                userId: request.auth.userId,
                tenantId: request.auth.tenantId,
                action: "logout",
                ip: request.ip,
                userAgent: request.headers["user-agent"],
            });
        }

        reply.clearCookie("token", { path: "/" });
        return { ok: true };
    });

    server.get("/auth/me", { preHandler: [authGuard] }, async (request, reply) => {
        const { userId, tenantId, role } = request.auth!;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true },
        });

        if (!user) {
            return reply.status(404).send({ error: "User not found" });
        }

        let tenant = null;
        if (tenantId) {
            tenant = await prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, name: true, slug: true },
            });
        }

        return {
            user,
            tenant,
            role,
        };
    });
}

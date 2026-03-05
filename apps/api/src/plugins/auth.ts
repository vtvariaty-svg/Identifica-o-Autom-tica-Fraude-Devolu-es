import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { AuthSession, Role } from "shared";

declare module "fastify" {
    interface FastifyRequest {
        auth?: AuthSession;
    }
}

export const getJwtSecret = () => {
    if (!process.env.JWT_SECRET) {
        throw new Error("Missing JWT_SECRET environment variable");
    }
    return process.env.JWT_SECRET;
};

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
    try {
        const token = request.cookies.token;
        if (!token) {
            return reply.status(401).send({ error: "Unauthorized: No token provided" });
        }

        const secret = getJwtSecret();
        const decoded = jwt.verify(token, secret) as AuthSession;

        request.auth = decoded;
    } catch (error) {
        return reply.status(401).send({ error: "Unauthorized: Invalid or expired token" });
    }
}

export function requireRole(allowedRoles: Role[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        // Ensure authGuard ran first
        if (!request.auth) {
            return reply.status(401).send({ error: "Unauthorized" });
        }

        if (!request.auth.role || !allowedRoles.includes(request.auth.role)) {
            return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
        }
    };
}

export async function tenantIsolationGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.auth) {
        return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!request.auth.tenantId) {
        return reply.status(403).send({ error: "Forbidden: No tenant context active" });
    }
}

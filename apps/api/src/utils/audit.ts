import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export async function logAudit(params: {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    ip?: string;
    userAgent?: string;
    metadata?: any;
}) {
    try {
        await prisma.auditLog.create({
            data: {
                tenant_id: params.tenantId || null,
                user_id: params.userId || null,
                action: params.action,
                ip: params.ip || null,
                user_agent: params.userAgent || null,
                metadata: params.metadata ? params.metadata : Prisma.JsonNull,
            },
        });
    } catch (err) {
        console.error("[AUDIT LOG ERROR]", err);
    }
}

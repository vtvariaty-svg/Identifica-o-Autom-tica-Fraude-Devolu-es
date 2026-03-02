import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard } from "../plugins/auth";

export const orderRoutes: FastifyPluginAsync = async (app) => {
    // Both endpoints require authentication and an active tenant
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    app.get("/", async (request, reply) => {
        const querySchema = z.object({
            limit: z.coerce.number().min(1).max(100).default(20),
            offset: z.coerce.number().min(0).default(0),
        });

        const { limit, offset } = querySchema.parse(request.query);
        const tenantId = request.auth!.tenantId!;

        const orders = await prisma.order.findMany({
            where: { tenant_id: tenantId },
            skip: offset,
            take: limit,
            select: {
                id: true,
                external_id: true,
                status: true,
                total_cents: true,
                placed_at: true,
                customer_id: true,
                created_at: true,
                // Notice: raw_payload is omitted by default as requested
            },
            orderBy: { created_at: "desc" },
        });

        const total = await prisma.order.count({
            where: { tenant_id: tenantId },
        });

        return reply.send({
            data: orders,
            meta: {
                total,
                limit,
                offset,
            },
        });
    });

    app.get("/:id", async (request, reply) => {
        const paramsSchema = z.object({
            id: z.string().uuid(),
        });

        const { id } = paramsSchema.parse(request.params);
        const tenantId = request.auth!.tenantId!;

        const order = await prisma.order.findFirst({
            where: {
                id,
                tenant_id: tenantId, // Strict isolation
            },
        });

        if (!order) {
            return reply.status(404).send({ error: "Order not found or access denied" });
        }

        return reply.send(order);
    });
};

export default orderRoutes;

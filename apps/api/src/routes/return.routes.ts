import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard } from "../plugins/auth";

export const returnRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    app.get("/", async (request, reply) => {
        const querySchema = z.object({
            limit: z.coerce.number().min(1).max(100).default(20),
            offset: z.coerce.number().min(0).default(0),
        });

        const { limit, offset } = querySchema.parse(request.query);
        const tenantId = request.auth!.tenantId!;

        const returns = await prisma.return.findMany({
            where: { tenant_id: tenantId },
            skip: offset,
            take: limit,
            select: {
                id: true,
                external_id: true,
                status: true,
                order_id: true,
                refund_amount_cents: true,
                requested_at: true,
                created_at: true,
            },
            orderBy: { created_at: "desc" },
        });

        const total = await prisma.return.count({
            where: { tenant_id: tenantId },
        });

        return reply.send({
            data: returns,
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

        const ret = await prisma.return.findFirst({
            where: {
                id,
                tenant_id: tenantId,
            },
            include: {
                items: true,
            }
        });

        if (!ret) {
            return reply.status(404).send({ error: "Return not found or access denied" });
        }

        return reply.send(ret);
    });
};

export default returnRoutes;

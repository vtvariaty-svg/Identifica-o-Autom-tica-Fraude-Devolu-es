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
            include: {
                order: { select: { external_id: true } },
                scores: {
                    orderBy: { computed_at: "desc" },
                    take: 1
                }
            } as any,
            orderBy: { created_at: "desc" },
        });

        const total = await prisma.return.count({
            where: { tenant_id: tenantId },
        });

        const mappedReturns = returns.map((ret: any) => {
            const latestScore = ret.scores?.[0] || null;
            return {
                id: ret.id,
                tenant_id: ret.tenant_id,
                external_id: ret.external_id,
                status: ret.status,
                reason: ret.reason,
                refund_amount_cents: ret.refund_amount_cents,
                order_id: ret.order_id,
                requested_at: ret.requested_at,
                created_at: ret.created_at,
                latest_score: latestScore?.score || null,
                latest_reasons_tags: latestScore ? (latestScore.reasons_json?.slice(0, 3).map((r: any) => r.label) || []) : [],
                latest_confidence: latestScore ? Number(latestScore.confidence) : null,
            };
        });

        return reply.send({
            data: mappedReturns,
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

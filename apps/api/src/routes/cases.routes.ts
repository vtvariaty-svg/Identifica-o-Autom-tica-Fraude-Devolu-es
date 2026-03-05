import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard, requireRole } from "../plugins/auth";

export const casesRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    // Endpoint 1: Cases Queue (Unresolved Returns)
    app.get("/", async (request, reply) => {
        const querySchema = z.object({
            limit: z.coerce.number().min(1).max(100).default(20),
            offset: z.coerce.number().min(0).default(0),
        });

        const { limit, offset } = querySchema.parse(request.query);
        const tenantId = request.auth!.tenantId!;

        // Fetch unresolved cases
        // A case is unresolved if it has NO decisions OR the latest decision does NOT exist
        // To simplify, we get ALL returns, map their latest decision locally, and filter.
        // For production at scale, this should be a direct raw SQL or careful Prisma relation query.

        const returns = await prisma.return.findMany({
            where: { tenant_id: tenantId },
            include: {
                scores: {
                    orderBy: { computed_at: "desc" },
                    take: 1
                } as any,
                decision: {
                    // Prisma still maps this as 1-to-1 or 1-to-N depending on schema cache.
                    // Since we removed @unique, it's 1-to-N now, but we need to bypass local type cache.
                } as any
            } as any
        });

        // Due to the schema caching issue we fetch decisions raw
        const allDecisionsForTenant = await prisma.decision.findMany({
            where: { tenant_id: tenantId },
            orderBy: { decided_at: "desc" }
        });

        // Map latest decision per return
        const latestDecisionMap = new Map<string, any>();
        for (const dec of allDecisionsForTenant) {
            if (!latestDecisionMap.has(dec.return_id)) {
                latestDecisionMap.set(dec.return_id, dec);
            }
        }

        // Filter returns that are unresolved (no decision)
        const openCases = returns
            .filter((ret: any) => !latestDecisionMap.has(ret.id))
            .map((ret: any) => {
                const latestScore = ret.scores?.[0] || null;
                return {
                    id: ret.id,
                    external_id: ret.external_id,
                    status: ret.status,
                    refund_amount_cents: ret.refund_amount_cents,
                    requested_at: ret.requested_at,
                    created_at: ret.created_at,
                    latest_score: latestScore?.score || null,
                    latest_reasons_tags: latestScore ? (latestScore.reasons_json?.slice(0, 3).map((r: any) => r.label) || []) : [],
                    score_computed_at: latestScore?.computed_at || null,
                };
            });

        // Custom Sort: Score Descending (nulls last) -> Refund Amount Descending
        openCases.sort((a, b) => {
            const scoreA = a.latest_score ?? -1;
            const scoreB = b.latest_score ?? -1;

            if (scoreA !== scoreB) {
                return scoreB - scoreA; // Descending score
            }

            // Tie-breaker: refund value
            const refundA = a.refund_amount_cents ?? 0;
            const refundB = b.refund_amount_cents ?? 0;
            return refundB - refundA;
        });

        // Apply Pagination
        const paginatedCases = openCases.slice(offset, offset + limit);

        return reply.send({
            data: paginatedCases,
            meta: {
                total: openCases.length,
                limit,
                offset,
            },
        });
    });

    // Endpoint 2: Submit Decision (Resolves a Case)
    app.post("/:id/decision", async (request, reply) => {
        // Enforce RBAC: only owner/admin can decide
        const userRole = request.auth!.role;
        if (userRole !== "owner" && userRole !== "admin") {
            return reply.status(403).send({ error: "Insufficient privileges to make decisions" });
        }

        const paramsSchema = z.object({ id: z.string().uuid() });
        const bodySchema = z.object({
            decision: z.enum(["approve", "reject", "request_evidence"]),
            note: z.string().max(2000).optional()
        });

        const { id } = paramsSchema.parse(request.params);
        const { decision, note } = bodySchema.parse(request.body);
        const tenantId = request.auth!.tenantId!;
        const userId = request.auth!.userId;

        // Validation: Note is mandatory for negative/blocking actions
        if ((decision === "reject" || decision === "request_evidence") && (!note || note.length < 5)) {
            return reply.status(400).send({ error: "A note of at least 5 characters is required to reject or request evidence." });
        }

        const returnCheck = await prisma.return.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                scores: { orderBy: { computed_at: "desc" }, take: 1 } as any
            } as any
        });

        if (!returnCheck) {
            return reply.status(404).send({ error: "Return not found or doesn't belong to this tenant" });
        }

        // 1. Transactionally insert Decision and Audit Log
        const latestScore = returnCheck.scores?.[0] || null;

        const newDecision = await prisma.$transaction(async (tx) => {
            const dec = await tx.decision.create({
                data: {
                    tenant_id: tenantId,
                    return_id: id,
                    decided_by_user_id: userId,
                    decision,
                    reason: note,
                    decided_at: new Date()
                } as any
            });

            await tx.auditLog.create({
                data: {
                    tenant_id: tenantId,
                    user_id: userId,
                    action: "decision_created",
                    ip: request.ip || null,
                    user_agent: request.headers["user-agent"] || null,
                    metadata: {
                        returnId: id,
                        decision,
                        noteLength: note ? note.length : 0,
                        scoreAtDecision: (latestScore as any)?.score || null,
                        modelVersion: (latestScore as any)?.model_version || null
                    },
                    created_at: new Date()
                } as any
            });

            return dec;
        });

        return reply.status(201).send({
            ok: true,
            decisionId: newDecision.id
        });
    });

};

export default casesRoutes;

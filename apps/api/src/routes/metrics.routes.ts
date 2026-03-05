import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard, requireRole } from "../plugins/auth";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    // Helper syntax to parse range/from/to dates
    const parseDateRange = (query: any) => {
        const schema = z.object({
            range: z.enum(["7d", "30d", "90d"]).optional(),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional()
        });
        const parsed = schema.parse(query);

        let to = parsed.to || new Date();
        let from = parsed.from;

        if (!from) {
            from = new Date();
            if (parsed.range === "7d") from.setDate(to.getDate() - 7);
            else if (parsed.range === "90d") from.setDate(to.getDate() - 90);
            else from.setDate(to.getDate() - 30); // default 30d
        }

        return { from, to };
    };

    // Helper to fetch and resolve all returns in the period for the tenant
    const fetchAggregatedReturns = async (tenantId: string, from: Date, to: Date) => {
        // Find all returns that fit in the date range (using requested_at, fallback created_at)
        const rawReturns = await prisma.return.findMany({
            where: {
                tenant_id: tenantId,
                OR: [
                    { requested_at: { gte: from, lte: to } },
                    { requested_at: null, created_at: { gte: from, lte: to } }
                ]
            },
            include: {
                order: { include: { customer: true } },
                scores: { orderBy: { computed_at: "desc" }, take: 1 },
                decisions: { orderBy: { decided_at: "desc" }, take: 1 },
                featuresSnapshot: { orderBy: { computed_at: "desc" }, take: 1 }
            } as any
        });

        return rawReturns.map(r => {
            const data = r as any;
            const latestScoreObj = data.scores?.[0] || null;
            const latestDecisionObj = data.decisions?.[0] || null;
            const latestSnapshotObj = data.featuresSnapshot?.[0] || null;

            // Value resolution logic
            let valueCents = 0;
            if (r.refund_amount_cents != null) {
                valueCents = r.refund_amount_cents;
            } else if (latestSnapshotObj && (latestSnapshotObj.features_json as any)?.returned_items_value_cents != null) {
                valueCents = Number((latestSnapshotObj.features_json as any).returned_items_value_cents);
            } else if (data.order?.total_cents != null) {
                valueCents = data.order.total_cents;
            }

            const score = latestScoreObj?.score || 0;
            const isHighRisk = score >= 70;
            const decisionStr = latestDecisionObj?.decision; // "approve", "reject", "request_evidence"

            const isPending = !decisionStr || decisionStr === "request_evidence";
            const isAvoided = decisionStr === "reject";
            const isApproved = decisionStr === "approve";

            return {
                id: r.id,
                valueCents,
                score,
                isHighRisk,
                isPending,
                isAvoided,
                isApproved,
                reasons: (latestScoreObj?.reasons_json as any) || [],
                customer: data.order?.customer || null
            };
        });
    };

    app.get("/summary", async (request, reply) => {
        const { from, to } = parseDateRange(request.query);
        const tenantId = request.auth!.tenantId!;

        const data = await fetchAggregatedReturns(tenantId, from, to);

        let returns_count = 0;
        let high_risk_count = 0;
        let pending_cases_count = 0;
        let decided_count = 0;

        let total_returns_value = 0;
        let high_risk_value = 0;
        let estimated_loss = 0;
        let avoided_loss = 0;
        let approved_loss = 0;

        for (const item of data) {
            returns_count++;
            total_returns_value += item.valueCents;

            if (item.isHighRisk) {
                high_risk_count++;
                high_risk_value += item.valueCents;

                if (item.isPending) {
                    estimated_loss += item.valueCents;
                }
            }

            if (item.isPending) {
                pending_cases_count++;
            } else {
                decided_count++;
            }

            if (item.isAvoided) avoided_loss += item.valueCents;
            if (item.isApproved) approved_loss += item.valueCents;
        }

        return reply.send({
            range: { from, to },
            currency: "BRL",
            totals: {
                returns_count,
                high_risk_count,
                pending_cases_count,
                decided_count
            },
            money_cents: {
                total_returns_value,
                high_risk_value,
                estimated_loss,
                avoided_loss,
                approved_loss
            },
            thresholds: { high_risk_score: 70 }
        });
    });

    app.get("/top-reasons", async (request, reply) => {
        const querySchema = z.object({ limit: z.coerce.number().min(1).max(50).default(10) });
        const { limit } = querySchema.parse(request.query);
        const { from, to } = parseDateRange(request.query);
        const tenantId = request.auth!.tenantId!;

        const data = await fetchAggregatedReturns(tenantId, from, to);

        const reasonsMap = new Map<string, { label: string, count: number, value_cents: number }>();

        for (const item of data) {
            for (const r of item.reasons) {
                if (!r || !r.code) continue;
                const existing = reasonsMap.get(r.code) || { label: r.label || r.code, count: 0, value_cents: 0 };
                existing.count++;
                existing.value_cents += item.valueCents;
                reasonsMap.set(r.code, existing);
            }
        }

        const sorted = Array.from(reasonsMap.entries())
            .map(([code, stats]) => ({ code, ...stats }))
            .sort((a, b) => b.value_cents - a.value_cents)
            .slice(0, limit);

        return reply.send(sorted);
    });

    app.get("/top-customers", async (request, reply) => {
        const querySchema = z.object({ limit: z.coerce.number().min(1).max(50).default(10) });
        const { limit } = querySchema.parse(request.query);
        const { from, to } = parseDateRange(request.query);
        const tenantId = request.auth!.tenantId!;

        const data = await fetchAggregatedReturns(tenantId, from, to);

        const customersMap = new Map<string, any>();

        for (const item of data) {
            const cust = item.customer;
            const customerKey = cust?.id ? `cust:${cust.id}`
                : cust?.external_id ? `external:${cust.external_id}`
                    : cust?.email ? `email:${cust.email}` : "unknown";

            const existing = customersMap.get(customerKey) || {
                customer_key: customerKey,
                customer_id: cust?.id || null,
                name: cust?.name || null,
                email: cust?.email || null,
                returns_count: 0,
                high_risk_count: 0,
                total_value_cents: 0,
                estimated_loss_cents: 0
            };

            existing.returns_count++;
            existing.total_value_cents += item.valueCents;

            if (item.isHighRisk) {
                existing.high_risk_count++;
                if (item.isPending) {
                    existing.estimated_loss_cents += item.valueCents;
                }
            }

            customersMap.set(customerKey, existing);
        }

        const sorted = Array.from(customersMap.values())
            .sort((a, b) => {
                if (b.estimated_loss_cents !== a.estimated_loss_cents) {
                    return b.estimated_loss_cents - a.estimated_loss_cents; // desc
                }
                return b.high_risk_count - a.high_risk_count; // tiebreaker
            })
            .slice(0, limit);

        return reply.send(sorted);
    });
};

export default metricsRoutes;

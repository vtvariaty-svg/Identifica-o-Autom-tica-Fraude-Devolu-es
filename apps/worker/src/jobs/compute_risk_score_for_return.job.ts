import { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function computeRiskScoreForReturnJob(job: Job) {
    const { tenantId, returnId, modelVersion = "rules_v1" } = job.data;

    if (!tenantId || !returnId) {
        throw new Error("Missing tenantId or returnId payload");
    }

    console.log(`[Worker] Started compute_risk_score_for_return for Return ${returnId} (Tenant ${tenantId})`);

    // 1. Fetch latest features snapshot
    const latestSnapshot = await prisma.featuresSnapshot.findFirst({
        where: { return_id: returnId, tenant_id: tenantId },
        orderBy: { computed_at: "desc" } as any, // Bypass local typing staleness
    });

    if (!latestSnapshot) {
        console.warn(`[Worker] Missing features snapshot for return ${returnId}. Skipping score computation.`);
        // Could also log an Audit Log here if implemented fully
        return { success: false, reason: "missing_features" };
    }

    const features: any = (latestSnapshot as any).features_json;

    // 2. Apply rules_v1 Engine
    let score = 0;
    let confidence = 0.75; // base
    const reasons: any[] = [];

    // Rule 1: days_to_return
    if (features.days_to_return !== null && features.days_to_return !== undefined) {
        const days = features.days_to_return;
        if (days <= 1) {
            score += 25;
            reasons.push({ code: "FAST_RETURN", label: "Devolução muito rápida", severity: "high", points: 25, evidence: { days_to_return: days, bucket: "<=1" } });
        } else if (days <= 3) {
            score += 15;
            reasons.push({ code: "FAST_RETURN_MODERATE", label: "Devolução rápida", severity: "medium", points: 15, evidence: { days_to_return: days, bucket: "2-3" } });
        } else if (days <= 7) {
            score += 8;
            reasons.push({ code: "RETURN_WITHIN_WEEK", label: "Devolução na primeira semana", severity: "low", points: 8, evidence: { days_to_return: days, bucket: "4-7" } });
        }
    }

    // Rule 2: customer_returns_30d
    if (features.customer_returns_30d !== undefined) {
        const retCount = features.customer_returns_30d;
        if (retCount >= 3) {
            score += 25;
            reasons.push({ code: "HIGH_RETURN_RATE_30D", label: "Múltiplas devoluções recentes", severity: "high", points: 25, evidence: { customer_returns_30d: retCount, bucket: ">=3" } });
        } else if (retCount === 2) {
            score += 15;
            reasons.push({ code: "MODERATE_RETURN_RATE_30D", label: "Algumas devoluções recentes", severity: "medium", points: 15, evidence: { customer_returns_30d: retCount, bucket: "==2" } });
        } else if (retCount === 1) {
            score += 8;
            reasons.push({ code: "LOW_RETURN_RATE_30D", label: "Possui devolução recente", severity: "low", points: 8, evidence: { customer_returns_30d: retCount, bucket: "==1" } });
        }
    }

    // Rule 3: refund_ratio
    if (features.refund_ratio !== undefined) {
        const ratio = features.refund_ratio;
        if (ratio >= 0.9) {
            score += 15;
            reasons.push({ code: "HIGH_REFUND_RATIO", label: "Reembolso quase total", severity: "medium", points: 15, evidence: { refund_ratio: ratio, bucket: ">=0.9" } });
        } else if (ratio >= 0.6) {
            score += 8;
            reasons.push({ code: "MODERATE_REFUND_RATIO", label: "Reembolso majoritário", severity: "low", points: 8, evidence: { refund_ratio: ratio, bucket: "0.6-0.89" } });
        }
    }

    // Rule 4: returned_items_value_cents
    if (features.returned_items_value_cents !== undefined) {
        const val = features.returned_items_value_cents;
        if (val >= 200000) { // 2.000 BRL
            score += 12;
            reasons.push({ code: "HIGH_VALUE_RETURN", label: "Devolução de alto valor (>$2000)", severity: "high", points: 12, evidence: { value_cents: val, bucket: ">=200000" } });
        } else if (val >= 50000) { // 500 BRL
            score += 6;
            reasons.push({ code: "MODERATE_VALUE_RETURN", label: "Devolução de valor médio (>$500)", severity: "medium", points: 6, evidence: { value_cents: val, bucket: ">=50000" } });
        }
    }

    // Rule 5: missing signals (Risk factor & Confidence penalty)
    let gaps = 0;
    if (features.missing_customer) {
        score += 8; gaps++; confidence -= 0.15;
    }
    if (features.missing_item_prices) {
        score += 6; gaps++; confidence -= 0.10;
    }
    if (features.missing_order_placed_at) {
        score += 6; gaps++; confidence -= 0.10;
    }
    if (features.missing_requested_at) {
        gaps++; confidence -= 0.10;
    }

    if (gaps > 0) {
        reasons.push({ code: "DATA_GAPS", label: "Dados ausentes (Risco Elevado/Baixa Confiança)", severity: gaps > 2 ? "high" : "medium", points: gaps * 5, evidence: { gaps_count: gaps } });
    }

    // Rule 6: return_items_count
    if (features.return_items_count !== undefined) {
        const items = features.return_items_count;
        if (items >= 4) {
            score += 6;
            reasons.push({ code: "HIGH_ITEM_COUNT", label: "Grande volume de itens", severity: "medium", points: 6, evidence: { return_items_count: items, bucket: ">=4" } });
        } else if (items === 3) {
            score += 4;
            reasons.push({ code: "MODERATE_ITEM_COUNT", label: "Vários itens", severity: "low", points: 4, evidence: { return_items_count: items, bucket: "==3" } });
        }
    }

    // Rule 7: Contextual fillers if very few rules triggered (Ensure 3-6 reasons rule)
    if (reasons.length < 3) {
        reasons.push({ code: "BASELINE_REVIEW", label: "Revisão Padrão Necessária", severity: "low", points: 0, evidence: { baseline: true } });
        if (features.order_total_cents > 0 && !reasons.find(r => r.code === "MODERATE_VALUE_RETURN" || r.code === "HIGH_VALUE_RETURN")) {
            reasons.push({ code: "CONTEXT_ORDER_VALUE", label: "Valor de Pedido Regular", severity: "low", points: 0, evidence: { order_total_cents: features.order_total_cents } });
        }
        if (reasons.length < 3) {
            reasons.push({ code: "CONTEXT_NORMAL_TIMING", label: "Timing da Devolução Regular", severity: "low", points: 0, evidence: { days_to_return: features.days_to_return || "N/A" } });
        }
    }

    // Clamp values
    score = Math.min(Math.max(score, 0), 100);
    confidence = Math.min(Math.max(confidence, 0.05), 0.95);

    // Sort reasons by points (highest impact first) and cap at 6
    reasons.sort((a, b) => b.points - a.points);
    const topReasons = reasons.slice(0, 6);

    // 3. Persist FraudScore Snapshot
    await prisma.fraudScore.create({
        data: {
            tenant_id: tenantId,
            return_id: returnId,
            model_version: modelVersion,
            score: score,
            confidence: confidence,
            reasons_json: topReasons,
            computed_at: new Date(),
        } as any // Bypass local PRISMA typing cache
    });

    console.log(`[Worker] fraud_score inserted for returnId ${returnId} (tenantId ${tenantId})`);
    return { success: true, score, confidence, reasonsCount: topReasons.length };
}

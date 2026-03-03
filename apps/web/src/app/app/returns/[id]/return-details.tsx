"use client";

import { useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { ShieldAlert, RefreshCw, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

export default function ReturnDetailsClient({ id, initialData }: { id: string, initialData: any }) {
    const [data, setData] = useState(initialData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { return: returnObj, order, features, featuresComputedAt, featuresStatus, score, reasons, scoreStatus } = data;

    const handleRecomputeFeatures = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/returns/${id}/compute-features`, { method: "POST" });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Erro ao acionar re-cálculo de sinais.");
            }

            // Polling limit: 10 attempts (20 seconds)
            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                try {
                    const checkRes = await apiFetch(`/returns/${id}/details`);
                    if (checkRes.ok) {
                        const checkData = await checkRes.json();
                        // If computed_at changed or status went from missing to ok
                        if (
                            checkData.featuresStatus === "ok" &&
                            checkData.featuresComputedAt !== featuresComputedAt
                        ) {
                            setData(checkData);
                            clearInterval(poll);
                            setLoading(false);
                        }
                    }
                } catch (e) { }

                if (attempts >= 10) {
                    clearInterval(poll);
                    setLoading(false);
                    setError("Timeout ao processar sinais. Recarregue a página mais tarde.");
                }
            }, 2000);

        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    const handleRecomputeScore = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/returns/${id}/compute-score`, { method: "POST" });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Erro ao acionar re-cálculo de score.");
            }

            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                try {
                    const checkRes = await apiFetch(`/returns/${id}/details`);
                    if (checkRes.ok) {
                        const checkData = await checkRes.json();
                        if (
                            checkData.scoreStatus === "ok" &&
                            (!score || checkData.score.computedAt !== score.computedAt)
                        ) {
                            setData(checkData);
                            clearInterval(poll);
                            setLoading(false);
                        }
                    }
                } catch (e) { }

                if (attempts >= 10) {
                    clearInterval(poll);
                    setLoading(false);
                    setError("Timeout ao processar score. Recarregue a página mais tarde.");
                }
            }, 2000);

        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Left Column: Essential Info */}
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-card shadow-sm rounded-lg p-6 border border-border">
                    <h2 className="text-xl font-bold mb-4">Informações Base</h2>
                    <dl className="space-y-3 text-sm">
                        <div>
                            <dt className="text-muted-foreground">ID Externo</dt>
                            <dd className="font-medium text-foreground">{returnObj.external_id || "N/A"}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Status</dt>
                            <dd className="font-medium text-foreground uppercase tracking-wider">{returnObj.status}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Motivo</dt>
                            <dd className="font-medium text-foreground">{returnObj.reason || "Não especificado"}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Reembolso Solicitado</dt>
                            <dd className="font-medium text-foreground">
                                {(returnObj.refund_amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </dd>
                        </div>
                    </dl>
                </div>

                <div className="bg-card shadow-sm rounded-lg p-6 border border-border">
                    <h2 className="text-xl font-bold mb-4">Pedido Original</h2>
                    <dl className="space-y-3 text-sm">
                        <div>
                            <dt className="text-muted-foreground">ID Externo</dt>
                            <dd className="font-medium text-foreground">{order?.external_id || "N/A"}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Cliente</dt>
                            <dd className="font-medium text-foreground">{order?.customer?.email || order?.customer?.name || "Desconhecido"}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Data da Compra</dt>
                            <dd className="font-medium text-foreground">
                                {order?.placed_at ? new Date(order.placed_at).toLocaleDateString("pt-BR") : "N/A"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">Total do Pedido</dt>
                            <dd className="font-medium text-foreground">
                                {order ? (order.total_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: order.currency }) : "N/A"}
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            {/* Right Column: Fraud Features */}
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-card shadow-sm rounded-lg border border-border overflow-hidden">
                    <div className="p-6 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <ShieldAlert className="w-6 h-6 text-primary" />
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    Sinais Anti-Fraude (Features)
                                </h2>
                                <p className="text-xs text-muted-foreground">
                                    {featuresStatus === "missing"
                                        ? "Sinais ainda não foram computados para esta devolução."
                                        : `Atualizado em: ${new Date(featuresComputedAt).toLocaleString("pt-BR")}`
                                    }
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleRecomputeFeatures}
                            disabled={loading}
                            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-4 py-2 rounded-md text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            Atualizar Sinais
                        </button>
                    </div>

                    {error && (
                        <div className="p-4 bg-destructive/10 text-destructive text-sm font-medium border-b border-destructive/20">
                            {error}
                        </div>
                    )}

                    <div className="p-6">
                        {featuresStatus === "missing" ? (
                            <div className="flex flex-col items-center justify-center text-center py-12 text-muted-foreground">
                                <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
                                <p>Os dados preditivos e sinais ainda não foram processados.</p>
                                <p className="text-sm mt-1">Clique em "Recalcular Sinais" no botão acima.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Feature Blocks */}
                                <FeatureCard
                                    title="Devoluções (30 Dias)"
                                    value={features.customer_returns_30d}
                                    highlight={features.customer_returns_30d > 2}
                                />
                                <FeatureCard
                                    title="Compras (30 Dias)"
                                    value={features.customer_orders_30d}
                                />
                                <FeatureCard
                                    title="Dias até Devolver"
                                    value={features.days_to_return !== null ? `${features.days_to_return} dias` : "N/A"}
                                    highlight={features.days_to_return !== null && features.days_to_return < 2}
                                />
                                <FeatureCard
                                    title="Itens na Devolução"
                                    value={features.return_items_count}
                                />
                                <FeatureCard
                                    title="Valor da Devolução (Itens)"
                                    value={(features.returned_items_value_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                />
                                <FeatureCard
                                    title="Taxa de Reembolso (Refund Ratio)"
                                    value={`${(features.refund_ratio * 100).toFixed(1)}%`}
                                    highlight={features.refund_ratio >= 1} // 100% or more
                                />
                            </div>
                        )}
                    </div>

                    {/* Flags Section */}
                    {featuresStatus === "ok" && (
                        <div className="px-6 pb-6 mt-2 pt-6 border-t border-border">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
                                Alertas Fixos (Booleans)
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                <FlagBadge flag={features.missing_customer} label="Cliente Não Vinculado" />
                                <FlagBadge flag={features.missing_order_placed_at} label="Data da Compra Ausente" />
                                <FlagBadge flag={features.missing_requested_at} label="Data da Solicitação Ausente" />
                                <FlagBadge flag={features.missing_item_prices} label="Preço Unitário Faltando nos Itens" />

                                {!features.missing_customer && !features.missing_order_placed_at && !features.missing_requested_at && !features.missing_item_prices && (
                                    <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-3 py-1.5 rounded-full">
                                        <CheckCircle2 className="w-4 h-4" /> Qualidade de Dados OK
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Score / AI Risk Section */}
                <div className="bg-card shadow-sm rounded-lg border border-border overflow-hidden">
                    <div className="p-6 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-4 bg-muted/10">
                        <div className="flex items-center gap-3">
                            <ShieldAlert className={`w-8 h-8 ${scoreStatus === "ok" ? (score.score >= 80 ? "text-red-500" : score.score >= 40 ? "text-amber-500" : "text-green-500") : "text-muted-foreground"}`} />
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded ml-2 align-middle">Beta</span>
                                    Risco (IA MVP)
                                </h2>
                                <p className="text-xs text-muted-foreground">
                                    {scoreStatus === "missing_features" ? "Sem features prontas para calcular." :
                                        scoreStatus === "missing_score" ? "Score ainda não foi calculado." :
                                            `Motor: ${score.modelVersion} | Atualizado: ${new Date(score.computedAt).toLocaleString("pt-BR")}`
                                    }
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleRecomputeScore}
                            disabled={loading || scoreStatus === "missing_features"}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            {loading ? "Processando..." : "Recalcular Score"}
                        </button>
                    </div>

                    <div className="p-6">
                        {scoreStatus === "missing_features" || scoreStatus === "missing_score" ? (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <AlertCircle className="w-10 h-10 mb-3 opacity-50 text-amber-500" />
                                <p className="font-medium text-foreground">Score indisponível.</p>
                                <p className="text-sm">
                                    {scoreStatus === "missing_features" ? "Sinais precisam ser gerados primeiro no card acima." : "Clique em Recalcular Score para acionar o motor de risco."}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                {/* Score Badge */}
                                <div className="flex flex-col items-center justify-center p-6 border border-border rounded-lg bg-background">
                                    <p className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Score Fraude</p>
                                    <div className={`w-32 h-32 rounded-full border-8 flex items-center justify-center ${score.score >= 80 ? "border-red-500 text-red-600 dark:text-red-400" :
                                        score.score >= 40 ? "border-amber-500 text-amber-600 dark:text-amber-400" :
                                            "border-green-500 text-green-600 dark:text-green-400"
                                        }`}>
                                        <span className="text-4xl font-black">{score.score}</span>
                                    </div>
                                    <p className="mt-4 text-sm font-semibold text-foreground">
                                        Confiança: <span className="font-mono bg-muted px-1 py-0.5 rounded">{(score.confidence * 100).toFixed(1)}%</span>
                                    </p>
                                </div>

                                {/* Reasons/Explainability */}
                                <div className="md:col-span-2">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
                                        Motivos & Evidências (Explicabilidade)
                                    </h3>
                                    <div className="space-y-3">
                                        {reasons.map((r: any, idx: number) => (
                                            <div key={idx} className={`p-4 rounded-lg border flex flex-col gap-2 ${r.severity === "high" ? "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-900/10" :
                                                r.severity === "medium" ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-900/10" :
                                                    "border-border bg-muted/30"
                                                }`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${r.severity === "high" ? "bg-red-500" : r.severity === "medium" ? "bg-amber-500" : "bg-blue-500"
                                                            }`}></span>
                                                        <span className="font-semibold text-foreground text-sm">{r.label}</span>
                                                        <span className="font-mono text-[10px] text-muted-foreground">{r.code}</span>
                                                    </div>
                                                    {r.points > 0 && (
                                                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-background border border-border">
                                                            +{r.points} pts
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted-foreground bg-background/50 p-2 rounded border border-border/50 font-mono mt-1 w-full overflow-x-auto">
                                                    {Object.entries(r.evidence).map(([k, v]) => (
                                                        <span key={k} className="mr-3">
                                                            <span className="opacity-70">{k}:</span> <strong className="opacity-100">{String(v)}</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function FeatureCard({ title, value, highlight = false }: { title: string, value: string | number, highlight?: boolean }) {
    return (
        <div className={`p-4 rounded-lg border ${highlight ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-muted/20"}`}>
            <p className="text-sm text-muted-foreground mb-1 font-medium">{title}</p>
            <p className={`text-2xl font-bold ${highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                {value}
            </p>
        </div>
    );
}

function FlagBadge({ flag, label }: { flag: boolean, label: string }) {
    if (!flag) return null;
    return (
        <span className="flex items-center gap-1.5 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded-full">
            <AlertTriangle className="w-4 h-4" />
            {label}
        </span>
    );
}

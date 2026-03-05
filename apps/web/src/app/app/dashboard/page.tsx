"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ShieldAlert, TrendingDown, Clock, ShieldCheck, Download, AlertTriangle } from "lucide-react";

export default function DashboardPage() {
    const { tenant } = useAuth();
    const [summary, setSummary] = useState<any>(null);
    const [topReasons, setTopReasons] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [range, setRange] = useState("30d");

    useEffect(() => {
        if (!tenant) return;

        async function fetchDashboard() {
            setIsLoading(true);
            try {
                const [sumRes, reasonsRes, custRes] = await Promise.all([
                    fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics/summary?range=${range}`),
                    fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics/top-reasons?range=${range}&limit=5`),
                    fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics/top-customers?range=${range}&limit=5`)
                ]);

                if (!sumRes.ok || !reasonsRes.ok || !custRes.ok) throw new Error("Falha ao carregar métricas");

                setSummary(await sumRes.json());
                setTopReasons(await reasonsRes.json());
                setTopCustomers(await custRes.json());
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        }

        fetchDashboard();
    }, [tenant, range]);

    const formatBRL = (cents: number) => {
        return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    };

    if (!tenant) return <div className="p-8">Selecione um tenant para visualizar o Dashboard.</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">ROI & Risco (Dashboard)</h1>
                    <p className="text-sm text-gray-500 mt-1">Impacto financeiro da inteligência antifraude em tempo real.</p>
                </div>
                <div className="flex items-center gap-2 bg-white rounded-md border p-1 shadow-sm">
                    {["7d", "30d", "90d"].map(r => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded ${range === r ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Últimos {r.replace('d', ' dias')}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="py-20 text-center text-gray-500">Computando agregações financeiras...</div>
            ) : error ? (
                <div className="p-4 bg-red-50 text-red-600 rounded border border-red-200">{error}</div>
            ) : (
                <>
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="bg-white rounded-xl border border-rose-200 shadow-sm p-6 relative overflow-hidden">
                            <div className="flex items-center justify-between mb-4 relative z-10">
                                <h3 className="font-semibold text-rose-900">Perda Estimada</h3>
                                <TrendingDown className="w-5 h-5 text-rose-500" />
                            </div>
                            <div className="text-3xl font-bold text-rose-700 relative z-10">{formatBRL(summary?.money_cents?.estimated_loss || 0)}</div>
                            <p className="text-sm text-rose-600/80 mt-1 relative z-10">Em risco (aguardando análise)</p>
                            <div className="absolute -bottom-6 -right-6 text-rose-50 opacity-50">
                                <AlertTriangle className="w-32 h-32" />
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-6 relative overflow-hidden">
                            <div className="flex items-center justify-between mb-4 relative z-10">
                                <h3 className="font-semibold text-emerald-900">Fraudes Evitadas</h3>
                                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div className="text-3xl font-bold text-emerald-700 relative z-10">{formatBRL(summary?.money_cents?.avoided_loss || 0)}</div>
                            <p className="text-sm text-emerald-600/80 mt-1 relative z-10">Devoluções negadas pela operação</p>
                        </div>

                        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-amber-900">Volume de Risco</h3>
                                <ShieldAlert className="w-5 h-5 text-amber-500" />
                            </div>
                            <div className="text-3xl font-bold text-amber-700">{summary?.totals?.high_risk_count || 0}</div>
                            <p className="text-sm text-amber-600/80 mt-1">Devoluções com Score {`>`}= 70</p>
                            <p className="text-xs font-semibold text-amber-700 mt-2 bg-amber-50 inline-block px-2 py-1 rounded">Total: {formatBRL(summary?.money_cents?.high_risk_value || 0)}</p>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">Casos Pendentes</h3>
                                <Clock className="w-5 h-5 text-gray-400" />
                            </div>
                            <div className="text-3xl font-bold text-gray-900">{summary?.totals?.pending_cases_count || 0}</div>
                            <p className="text-sm text-gray-500 mt-1">Aguardando decisão final</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Top Reasons */}
                        <div className="bg-white rounded-xl shadow-sm border p-6 bg-gradient-to-tr from-white to-slate-50">
                            <h3 className="font-bold text-lg text-gray-900 mb-6 flex items-center">
                                <ShieldAlert className="w-5 h-5 mr-2 text-indigo-500" />
                                Top Motivos de Alerta
                            </h3>
                            {topReasons.length === 0 ? (
                                <p className="text-gray-500 text-sm">Sem dados suficientes no período.</p>
                            ) : (
                                <div className="space-y-4">
                                    {topReasons.map((r, i) => (
                                        <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white rounded-lg border shadow-sm">
                                            <div className="flex items-center space-x-3">
                                                <span className="flex-shrink-0 w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 border">{i + 1}</span>
                                                <div>
                                                    <p className="font-semibold text-sm text-gray-800">{r.label}</p>
                                                    <p className="text-xs text-gray-500 font-mono mt-0.5">{r.code}</p>
                                                </div>
                                            </div>
                                            <div className="mt-2 sm:mt-0 text-right">
                                                <p className="font-bold text-indigo-700 text-sm">{formatBRL(r.value_cents)}</p>
                                                <p className="text-xs text-gray-500">{r.count} devoluções</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Top Customers */}
                        <div className="bg-white rounded-xl shadow-sm border p-6">
                            <h3 className="font-bold text-lg text-gray-900 mb-6 flex items-center">
                                <AlertTriangle className="w-5 h-5 mr-2 text-rose-500" />
                                Top Clientes com Risco Identificado
                            </h3>
                            {topCustomers.length === 0 ? (
                                <p className="text-gray-500 text-sm">Sem clientes sob alerta no período.</p>
                            ) : (
                                <div className="space-y-4">
                                    {topCustomers.map((c, i) => (
                                        <div key={i} className="flex flex-col p-3 rounded-lg border border-gray-100 hover:bg-slate-50 transition-colors">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="font-medium text-sm text-gray-900">{c.name || "Cliente Desconhecido"}</p>
                                                    <p className="text-xs text-gray-500">{c.email || c.customer_key}</p>
                                                </div>
                                                <span className="inline-flex text-[10px] items-center px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold tracking-wide">
                                                    Risco: {formatBRL(c.estimated_loss_cents)}
                                                </span>
                                            </div>
                                            <div className="flex gap-4 text-xs mt-1">
                                                <div className="text-gray-600">Total: {formatBRL(c.total_value_cents)}</div>
                                                <div className="text-amber-600 font-medium">{c.high_risk_count}/{c.returns_count} de risco</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

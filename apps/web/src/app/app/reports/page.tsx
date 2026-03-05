"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Download, Search, AlertCircle, Users } from "lucide-react";

export default function ReportsPage() {
    const { tenant } = useAuth();
    const [topReasons, setTopReasons] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // date controls
    const [from, setFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]);

    const fetchReports = async () => {
        if (!tenant) return;
        setIsLoading(true);
        setError(null);
        try {
            const query = `from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z&limit=50`;
            const [reasonsRes, custRes] = await Promise.all([
                fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics/top-reasons?${query}`),
                fetch(`${process.env.NEXT_PUBLIC_API_URL}/metrics/top-customers?${query}`)
            ]);

            if (!reasonsRes.ok || !custRes.ok) throw new Error("Falha ao carregar relatórios");

            setTopReasons(await reasonsRes.json());
            setTopCustomers(await custRes.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, [tenant]);

    const formatBRL = (cents: number) => {
        return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    };

    if (!tenant) return <div className="p-8">Selecione um tenant para visualizar os relatórios.</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">Relatórios Analíticos</h1>
                    <p className="text-sm text-gray-500 mt-1">Dados agregados detalhados de fraude na sua operação.</p>
                </div>

                <div className="flex items-end gap-3 bg-white p-3 rounded-xl border shadow-sm">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">De</label>
                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Ate</label>
                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6" />
                    </div>
                    <button onClick={fetchReports} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium text-sm shadow-sm transition-colors">
                        Aplicar Filtro
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="py-20 text-center text-gray-500">Buscando dados no período selecionado...</div>
            ) : error ? (
                <div className="p-4 bg-red-50 text-red-600 rounded border border-red-200">{error}</div>
            ) : (
                <div className="space-y-8">

                    {/* Top Reasons Table */}
                    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                        <div className="flex items-center space-x-2 px-6 py-4 border-b bg-slate-50">
                            <AlertCircle className="w-5 h-5 text-indigo-500" />
                            <h2 className="text-lg font-semibold text-gray-800">Principais Sinais / Motivos (Top 50)</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-white border-b">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Motivo (Label / Code)</th>
                                        <th className="px-6 py-3 font-medium text-right">Volume (Qtd)</th>
                                        <th className="px-6 py-3 font-medium text-right">Valor em Risco (R$)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {topReasons.length === 0 ? (
                                        <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-500">Sem dados no período</td></tr>
                                    ) : (
                                        topReasons.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold text-gray-900">{r.label}</div>
                                                    <div className="text-xs text-gray-500 font-mono">{r.code}</div>
                                                </td>
                                                <td className="px-6 py-4 text-right font-medium text-gray-700">{r.count}</td>
                                                <td className="px-6 py-4 text-right font-bold text-indigo-700">{formatBRL(r.value_cents)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Top Customers Table */}
                    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                        <div className="flex items-center space-x-2 px-6 py-4 border-b bg-slate-50">
                            <Users className="w-5 h-5 text-rose-500" />
                            <h2 className="text-lg font-semibold text-gray-800">Ranking: Clientes Suspeitos (Top 50)</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-white border-b">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Cliente</th>
                                        <th className="px-6 py-3 font-medium text-center">Devoluções (Total)</th>
                                        <th className="px-6 py-3 font-medium text-center">Alto Risco (Qtd)</th>
                                        <th className="px-6 py-3 font-medium text-right">Valor Total Devolvido</th>
                                        <th className="px-6 py-3 font-medium text-right">Perda Estimada (Risco)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {topCustomers.length === 0 ? (
                                        <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Sem dados no período</td></tr>
                                    ) : (
                                        topCustomers.map((c, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold text-gray-900">{c.name || "Sem Nome"}</div>
                                                    <div className="text-xs text-gray-500">{c.email || c.customer_key}</div>
                                                </td>
                                                <td className="px-6 py-4 text-center font-medium text-gray-700">{c.returns_count}</td>
                                                <td className="px-6 py-4 text-center font-bold text-amber-600">{c.high_risk_count}</td>
                                                <td className="px-6 py-4 text-right font-medium text-gray-600">{formatBRL(c.total_value_cents)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-rose-700 bg-rose-50/30">{formatBRL(c.estimated_loss_cents)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}

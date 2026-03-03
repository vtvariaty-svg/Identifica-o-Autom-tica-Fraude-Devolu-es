"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/card-table"; // Assuming standard UI table or default fallback
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, AlertTriangleIcon, SearchIcon, CheckCircleIcon } from "lucide-react";
import Link from "next/link";

interface OpenCase {
    id: string;
    external_id: string | null;
    status: string;
    refund_amount_cents: number | null;
    requested_at: string | null;
    created_at: string;
    latest_score: number | null;
    latest_reasons_tags: string[];
    score_computed_at: string | null;
}

export default function CasesQueuePage() {
    const { token, tenant } = useAuth();
    const [cases, setCases] = useState<OpenCase[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token || !tenant) return;

        async function fetchCases() {
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/cases`, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });

                if (!res.ok) {
                    throw new Error("Failed to fetch cases");
                }

                const json = await res.json();
                setCases(json.data || []);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        }

        fetchCases();
    }, [token, tenant]);

    const formatCurrency = (cents: number | null) => {
        if (cents == null) return "—";
        return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    };

    const formatDate = (isoStr: string | null) => {
        if (!isoStr) return "—";
        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        }).format(new Date(isoStr));
    };

    const getScoreBadge = (score: number | null) => {
        if (score === null) {
            return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">Sem nota</span>;
        }
        if (score >= 80) return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800">Risco Alto ({score})</span>;
        if (score >= 40) return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">Médio ({score})</span>;
        return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800">Baixo ({score})</span>;
    };


    if (!tenant) return <div className="p-8">Selecione um tenant para visualizar a Fila de Casos.</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">Fila de Casos</h1>
                    <p className="text-sm text-gray-500 mt-1">Devoluções suspeitas aguardando análise e decisão de operadores.</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border shadow-sm">
                    <ShieldCheckIcon className="w-4 h-4 text-emerald-600" />
                    <span>Nenhum caso vazando</span>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Análise Pendente ({cases.length})</CardTitle>
                    <CardDescription>
                        Itens listados aqui estão com status pendente de auditoria manual. A ordem prioriza devoluções com as maiores notas de Fraude.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="py-8 text-center text-gray-500">Carregando fila...</div>
                    ) : error ? (
                        <div className="py-8 text-center text-red-500">Erro: {error}</div>
                    ) : cases.length === 0 ? (
                        <div className="py-16 text-center">
                            <CheckCircleIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                            <h3 className="text-lg font-medium text-gray-900">Fila limpa!</h3>
                            <p className="text-gray-500">Não há devoluções suspeitas aguardando análise no momento.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="text-xs text-gray-500 uppercase bg-gray-50/50 border-b">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">ID / Data</th>
                                        <th className="px-4 py-3 font-medium">Score (IA MVP)</th>
                                        <th className="px-4 py-3 font-medium">Motivos (Sinais)</th>
                                        <th className="px-4 py-3 font-medium text-right">Valor Extornado</th>
                                        <th className="px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {cases.map((c) => (
                                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <div className="font-medium text-gray-900">{c.external_id || c.id.substring(0, 8)}</div>
                                                <div className="text-xs text-gray-500">{formatDate(c.requested_at || c.created_at)}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {getScoreBadge(c.latest_score)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {c.latest_reasons_tags && c.latest_reasons_tags.length > 0 ? (
                                                        c.latest_reasons_tags.map((tag, idx) => (
                                                            <span key={idx} className="inline-flex text-[10px] items-center px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-gray-400 text-xs italic">Sem tags de risco</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-medium text-right text-gray-900">
                                                {formatCurrency(c.refund_amount_cents)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Link href={`/app/cases/${c.id}`}>
                                                    <Button size="sm" variant="outline" className="text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                                                        Abrir Caso
                                                        <ArrowRightIcon className="w-3 h-3 ml-1.5" />
                                                    </Button>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, apiFetch } from "@/lib/api";

export default function ImportDetailsClient({ id }: { id: string }) {
    const [run, setRun] = useState<any>(null);
    const [errors, setErrors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [reprocessing, setReprocessing] = useState(false);
    const router = useRouter();

    useEffect(() => {
        let interval: NodeJS.Timeout;

        const fetchData = async () => {
            try {
                // Fetch Run Details
                const runRes = await apiFetch(`/imports/${id}`);
                const runData = await runRes.json();
                setRun(runData);

                // Fetch Errors conditionally
                if (runData.status === "success" || runData.status === "failed") {
                    const errRes = await apiFetch(`/imports/${id}/errors`);
                    const errData = await errRes.json();
                    setErrors(errData.data || []);
                }

                // Polling exit condition
                if (runData.status === "success" || runData.status === "failed") {
                    clearInterval(interval);
                    setLoading(false);
                }
            } catch (err) {
                console.error("Failed to fetch import details:", err);
                clearInterval(interval);
                setLoading(false);
            }
        };

        fetchData();
        interval = setInterval(fetchData, 2000); // Poll every 2 seconds

        return () => clearInterval(interval);
    }, [id]);

    if (loading && !run) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando detalhes da importação...</div>;
    }

    if (!run) {
        return <div className="p-8 text-center text-destructive">Importação não encontrada ou acesso negado.</div>;
    }

    const handleReprocess = async () => {
        if (!confirm("Tem certeza que deseja reprocessar esta importação? Uma nova execução será enfileirada.")) return;
        setReprocessing(true);
        try {
            const res = await apiFetch(`/imports/${id}/reprocess`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.newImportRunId) {
                router.push(`/app/imports/${data.newImportRunId}`);
            } else {
                alert(data.error || "Erro ao reprocessar.");
            }
        } catch (err: any) {
            alert("Erro de conexão ao reprocessar a fila.");
        } finally {
            setReprocessing(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Header Details */}
            <div className="bg-card shadow-sm rounded-lg border border-border p-6 grid grid-cols-1 md:grid-cols-2 gap-6 relative">

                {/* Reprocess Button Overlay if applicable */}
                {(run.status === "failed" || run.error_rows > 0) && (
                    <div className="absolute top-6 right-6">
                        <button
                            onClick={handleReprocess}
                            disabled={reprocessing || loading}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                        >
                            {reprocessing ? "Reprocessando..." : "↻ Reprocessar Falhas"}
                        </button>
                    </div>
                )}

                <div>
                    <h2 className="text-xl font-semibold mb-4">Informações do Arquivo</h2>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        <li><span className="font-medium text-foreground">Arquivo:</span> {run.file_name}</li>
                        <li><span className="font-medium text-foreground">Entidade:</span> {run.entity_type}</li>
                        <li><span className="font-medium text-foreground">Cadastrado em:</span> {new Date(run.created_at).toLocaleString()}</li>
                        <li><span className="font-medium text-foreground">Finalizado em:</span> {run.finished_at ? new Date(run.finished_at).toLocaleString() : "Processando..."}</li>
                    </ul>
                </div>
                <div>
                    <h2 className="text-xl font-semibold mb-4 flex items-center gap-3">
                        Status do Processamento
                        <span className="text-sm px-2 py-1 bg-muted rounded-md tracking-wider uppercase font-bold text-foreground">
                            {run.status}
                        </span>
                    </h2>
                    <div className="grid grid-cols-3 gap-4 text-center mt-6">
                        <div className="bg-muted/50 p-4 rounded-md">
                            <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Total Linhas</p>
                            <p className="text-2xl font-bold">{run.total_rows ?? "-"}</p>
                        </div>
                        <div className="bg-green-500/10 p-4 rounded-md text-green-700 dark:text-green-400">
                            <p className="text-xs uppercase font-bold mb-1">Sucesso</p>
                            <p className="text-2xl font-bold">{run.success_rows ?? "-"}</p>
                        </div>
                        <div className="bg-red-500/10 p-4 rounded-md text-red-700 dark:text-red-400">
                            <p className="text-xs uppercase font-bold mb-1">Erros</p>
                            <p className="text-2xl font-bold">{run.error_rows ?? "-"}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Error Table */}
            {errors.length > 0 && (
                <div className="bg-card shadow-sm rounded-lg border border-border">
                    <div className="p-6 border-b border-border/50">
                        <h2 className="text-lg font-semibold text-destructive flex gap-2 items-center">
                            ⚠ Registros com Erro ({run.error_rows})
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">As linhas abaixo falharam durante a validação ou inserção e foram ignoradas.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase">
                                <tr>
                                    <th className="px-6 py-3 font-semibold w-24">Linha</th>
                                    <th className="px-6 py-3 font-semibold">Mensagem de Erro</th>
                                    <th className="px-6 py-3 font-semibold">Payload Recebido (JSON)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {errors.map((err) => (
                                    <tr key={err.id} className="hover:bg-muted/10">
                                        <td className="px-6 py-4 font-mono text-muted-foreground">#{err.line_number}</td>
                                        <td className="px-6 py-4 text-red-600 dark:text-red-400 font-medium">{err.message}</td>
                                        <td className="px-6 py-4">
                                            <pre className="p-2 bg-muted/50 rounded text-xs text-muted-foreground font-mono overflow-auto max-w-[400px]">
                                                {JSON.stringify(err.payload, null, 2)}
                                            </pre>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

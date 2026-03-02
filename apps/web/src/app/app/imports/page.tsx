import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import Link from "next/link";

async function getImports(token: string) {
    const res = await fetch(`${API_URL}/imports`, {
        headers: { Cookie: `token=${token}` },
        cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
}

export default async function ImportsHistoryPage() {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const tokenMatch = cookie.match(/token=([^;]+)/);

    if (!tokenMatch) {
        redirect("/login");
    }

    const json = await getImports(tokenMatch[1]);
    const runs = json?.data || [];

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-foreground">Histórico de Importações</h1>
                <Link
                    href="/app/import"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    Nova Importação
                </Link>
            </div>

            <div className="bg-card shadow-sm rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                        <tr>
                            <th className="px-6 py-4 font-semibold">Arquivo</th>
                            <th className="px-6 py-4 font-semibold">Entidade</th>
                            <th className="px-6 py-4 font-semibold">Status</th>
                            <th className="px-6 py-4 font-semibold">Linhas (Sucesso/Falha)</th>
                            <th className="px-6 py-4 font-semibold">Data</th>
                            <th className="px-6 py-4 text-center font-semibold">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-card content">
                        {runs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                    Nenhuma importação encontrada neste Tenant.
                                </td>
                            </tr>
                        ) : (
                            runs.map((run: any) => (
                                <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap font-medium">{run.file_name || "N/A"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">{run.entity_type}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <StatusBadge status={run.status} />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">
                                        {run.total_rows || "-"} / {run.success_rows || "0"} / <span className={run.error_rows > 0 ? "text-destructive font-bold" : ""}>{run.error_rows || "0"}</span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">
                                        {new Date(run.created_at).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <Link href={`/app/imports/${run.id}`} className="text-primary hover:underline text-sm font-medium">
                                            Ver Detalhes
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        queued: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
        running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
        success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
        failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };

    const labels: Record<string, string> = {
        queued: "Na Fila",
        running: "Processando",
        success: "Concluído",
        failed: "Falhou",
    };

    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[status] || "bg-gray-100 text-gray-800"}`}>
            {labels[status] || status}
        </span>
    );
}

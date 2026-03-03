import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import Link from "next/link";

async function getReturns(token: string) {
    const res = await fetch(`${API_URL}/returns`, {
        headers: { Cookie: `token=${token}` },
        cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
}

export default async function ReturnsListPage() {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const tokenMatch = cookie.match(/token=([^;]+)/);

    if (!tokenMatch) {
        redirect("/login");
    }

    const { data: returns = [] } = (await getReturns(tokenMatch[1])) || {};

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-foreground">Devoluções Registradas</h1>
                <Link
                    href="/app/import"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 text-sm font-medium transition-colors"
                >
                    Importar CSV
                </Link>
            </div>

            <div className="bg-card shadow-sm rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs border-b">
                        <tr>
                            <th className="px-6 py-4 font-semibold">ID Externo</th>
                            <th className="px-6 py-4 font-semibold">Status</th>
                            <th className="px-6 py-4 font-semibold">Motivo</th>
                            <th className="px-6 py-4 font-semibold">Valor</th>
                            <th className="px-6 py-4 font-semibold">Data da Solicitação</th>
                            <th className="px-6 py-4 text-center font-semibold">Investigar</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-card content">
                        {returns.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                    Nenhuma devolução encontrada.
                                </td>
                            </tr>
                        ) : (
                            returns.map((ret: any) => (
                                <tr key={ret.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap font-medium text-foreground">{ret.external_id}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">
                                            {ret.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">{ret.reason || "-"}</td>
                                    <td className="px-6 py-4 font-semibold">
                                        {(ret.refund_amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                        {ret.requested_at ? new Date(ret.requested_at).toLocaleDateString("pt-BR") : new Date(ret.created_at).toLocaleDateString("pt-BR")}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <Link
                                            href={`/app/returns/${ret.id}`}
                                            className="text-primary hover:underline font-medium flex items-center justify-center gap-1"
                                        >
                                            Ver Alertas
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

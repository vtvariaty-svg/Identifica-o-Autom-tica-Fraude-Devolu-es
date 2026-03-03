import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import Link from "next/link";
import ReturnDetailsClient from "../../returns/[id]/return-details";
import CaseDecisionClient from "./case-decision";

async function getReturnDetails(id: string, token: string) {
    const res = await fetch(`${API_URL}/returns/${id}/details`, {
        headers: { Cookie: `token=${token}` },
        cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
}

export default async function CaseDetailsPage({ params }: { params: { id: string } }) {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const tokenMatch = cookie.match(/token=([^;]+)/);

    if (!tokenMatch) {
        redirect("/login");
    }

    const { id } = await params;
    const initialData = await getReturnDetails(id, tokenMatch[1]);

    if (!initialData) {
        return (
            <div className="max-w-6xl mx-auto py-8 px-4 text-center">
                <h1 className="text-2xl font-bold text-destructive">Caso não encontrado</h1>
                <Link href="/app/cases" className="text-primary hover:underline mt-4 block">Voltar à fila</Link>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <div className="flex items-center gap-4 mb-6 border-b pb-4">
                <Link href="/app/cases" className="text-muted-foreground hover:text-foreground">← Voltar à Fila</Link>
                <h1 className="text-3xl font-bold text-foreground">
                    Análise de Caso
                </h1>
                <span className="ml-auto text-sm bg-muted px-2 py-1 rounded text-muted-foreground font-mono">
                    ID: {id.split("-").pop()}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <ReturnDetailsClient id={id} initialData={initialData} />
                </div>
                <div className="lg:col-span-1 space-y-6">
                    <CaseDecisionClient id={id} initialData={initialData} />
                </div>
            </div>
        </div>
    );
}

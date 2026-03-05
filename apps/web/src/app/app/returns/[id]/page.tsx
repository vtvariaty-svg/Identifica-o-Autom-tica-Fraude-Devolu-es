import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";
import Link from "next/link";
import ReturnDetailsClient from "./return-details";

async function getReturnDetails(id: string, token: string) {
    const res = await fetch(`${API_URL}/returns/${id}/details`, {
        headers: { Cookie: `token=${token}` },
        cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
}

export default async function ReturnDetailsPage({ params }: { params: { id: string } }) {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const tokenMatch = cookie.match(/token=([^;]+)/);

    if (!tokenMatch) {
        redirect("/login");
    }

    // Next.js 15: Unwrap params
    const { id } = await params;
    const initialData = await getReturnDetails(id, tokenMatch[1]);

    if (!initialData) {
        return (
            <div className="max-w-6xl mx-auto py-8 px-4 text-center">
                <h1 className="text-2xl font-bold text-destructive">Devolução não encontrada</h1>
                <Link href="/app/returns" className="text-primary hover:underline mt-4 block">Voltar</Link>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <div className="flex items-center gap-4 mb-6 border-b pb-4">
                <Link href="/app" className="text-muted-foreground hover:text-foreground">← Voltar</Link>
                <h1 className="text-3xl font-bold text-foreground">
                    Detalhes da Devolução
                </h1>
                <span className="ml-auto text-sm bg-muted px-2 py-1 rounded text-muted-foreground font-mono">
                    ID: {id.split("-").pop()}
                </span>
            </div>

            <ReturnDetailsClient id={id} initialData={initialData} />
        </div>
    );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import ImportDetailsClient from "./import-details";

export default async function ImportDetailsPage({ params }: { params: { id: string } }) {
    const hdrs = await headers();
    const cookie = hdrs.get("cookie") || "";
    const tokenMatch = cookie.match(/token=([^;]+)/);

    if (!tokenMatch) {
        redirect("/login");
    }

    // Unwrap params in Next.js 15
    const { id } = await params;

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <h1 className="text-3xl font-bold mb-6 text-foreground border-b pb-4">Detalhes da Importação</h1>
            <ImportDetailsClient id={id} />
        </div>
    );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function ImportPage() {
    // Basic auth check logic if missing, relies on previous steps.
    const hdrs = await headers();
    const token = hdrs.get("cookie")?.includes("token=");
    if (!token) {
        redirect("/login");
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <h1 className="text-3xl font-bold mb-6 text-foreground">Importar Dados CSV</h1>

            <div className="bg-card text-card-foreground shadow-sm rounded-lg p-6 border border-border">
                <p className="mb-6 text-muted-foreground">
                    Faça o upload do seu arquivo CSV com os dados canônicos. O processamento será feito em segundo plano e você poderá acompanhar o status no histórico.
                </p>

                {/* ImportForm uses client-side fetch */}
                <ImportForm />
            </div>
        </div>
    );
}

// Client Component embedded for simplicity. Typically extracting but kept together for MVP.
import { ImportForm } from "./import-form";

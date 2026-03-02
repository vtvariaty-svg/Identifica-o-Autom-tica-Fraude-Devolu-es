"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";

export function ImportForm() {
    const router = useRouter();
    const [entityType, setEntityType] = useState("orders");
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setError("Por favor, selecione um arquivo.");
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const formData = new FormData();
            formData.append("entityType", entityType);
            formData.append("file", file);

            const res = await fetch(`${API_URL}/imports/csv`, {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Erro ao enviar arquivo");
            }

            const data = await res.json();

            // Redirect to details view for tracking status
            router.push(`/app/imports/${data.importRunId}`);

        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
                <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm border border-destructive/20">
                    {error}
                </div>
            )}

            <div>
                <label className="block text-sm font-medium mb-2">Entidade do CSV</label>
                <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                    <option value="customers">Clientes (Customers)</option>
                    <option value="orders">Pedidos (Orders)</option>
                    <option value="order_items">Itens do Pedido (Order Items)</option>
                    <option value="returns">Devoluções (Returns)</option>
                    <option value="return_items">Itens de Devolução (Return Items)</option>
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium mb-2">Arquivo CSV</label>
                <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                />
            </div>

            <div className="pt-2">
                <button
                    type="submit"
                    disabled={loading || !file}
                    className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                    {loading ? "Enviando e Processando..." : "Fazer Upload"}
                </button>
            </div>
        </form>
    );
}

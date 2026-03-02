"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Building, Plus, CheckCircle } from "lucide-react";

interface TenantData {
    id: string;
    name: string;
    slug: string;
    role: string;
}

export default function TenantsPage() {
    const { tenant: activeTenant, refreshSession } = useAuth();
    const [tenants, setTenants] = useState<TenantData[]>([]);
    const [loading, setLoading] = useState(true);
    const [newTenantName, setNewTenantName] = useState("");
    const [creating, setCreating] = useState(false);

    const fetchTenants = async () => {
        try {
            const data = await apiFetch("/tenants");
            setTenants(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, [activeTenant]);

    const handleCreateTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTenantName) return;
        setCreating(true);
        try {
            await apiFetch("/tenants", {
                method: "POST",
                body: JSON.stringify({ name: newTenantName }),
            });
            setNewTenantName("");
            // Refresh list and global session (since the backend might have issued a new token)
            await fetchTenants();
            await refreshSession();
        } catch (err) {
            alert("Failed to create tenant");
        } finally {
            setCreating(false);
        }
    };

    const handleSelectTenant = async (tenantId: string) => {
        try {
            await apiFetch("/tenants/select", {
                method: "POST",
                body: JSON.stringify({ tenantId }),
            });
            await refreshSession();
        } catch (err) {
            alert("Failed to switch tenant");
        }
    };

    if (loading) return <div>Carregando tenants...</div>;

    return (
        <div className="space-y-8 max-w-5xl">
            <div>
                <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
                    Suas Organizações (Tenants)
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                    Gerencie e alterne entre as organizações nas quais você possui acesso.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* List of Tenants */}
                <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
                    <h3 className="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Tenants Disponíveis</h3>
                    <ul className="space-y-4">
                        {tenants.map((t) => {
                            const isActive = t.id === activeTenant?.id;
                            return (
                                <li
                                    key={t.id}
                                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border ${isActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                                        }`}
                                >
                                    <div className="flex items-center">
                                        <Building className={`h-6 w-6 mr-3 ${isActive ? "text-blue-500" : "text-gray-400"}`} />
                                        <div>
                                            <p className="font-semibold text-gray-900 flex items-center gap-2">
                                                {t.name}
                                                {isActive && <CheckCircle className="h-4 w-4 text-blue-500" />}
                                            </p>
                                            <p className="text-xs text-gray-500">Permissão: {t.role}</p>
                                        </div>
                                    </div>
                                    {!isActive && (
                                        <button
                                            onClick={() => handleSelectTenant(t.id)}
                                            className="mt-3 sm:mt-0 text-sm bg-white hover:bg-gray-100 border border-gray-300 px-3 py-1 rounded shadow-sm text-gray-700 font-medium"
                                        >
                                            Acessar
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* Create Tenant Form */}
                <div className="bg-white shadow rounded-lg p-6 border border-gray-100 self-start">
                    <h3 className="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Criar Novo Tenant</h3>
                    <form onSubmit={handleCreateTenant} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Nome da Organização</label>
                            <input
                                type="text"
                                required
                                placeholder="Ex: Nova Loja"
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={newTenantName}
                                onChange={(e) => setNewTenantName(e.target.value)}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={creating}
                            className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            {creating ? "Criando..." : "Criar Tenant"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

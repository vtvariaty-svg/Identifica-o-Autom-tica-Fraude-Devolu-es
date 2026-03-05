"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Plug, Plus, RefreshCw, AlertCircle, CheckCircle2, ShoppingBag, Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useSearchParams } from "next/navigation";

interface Connector {
    id: string;
    type: string;
    name: string;
    status: string;
    shop_domain: string;
    last_sync_at: string | null;
    last_error_at: string | null;
    last_error: string | null;
    created_at: string;
}

export default function ConnectorsPage() {
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const justConnectedShopify = searchParams.get("shopify") === "connected";
    const justConnectedMeli = searchParams.get("meli") === "connected";

    const [connectors, setConnectors] = useState<Connector[]>([]);
    const [loading, setLoading] = useState(true);
    const [shopDomain, setShopDomain] = useState("");
    const [installingShopify, setInstallingShopify] = useState(false);
    const [installingMeli, setInstallingMeli] = useState(false);
    const [installingShopee, setInstallingShopee] = useState(false);
    const [shopeeShopId, setShopeeShopId] = useState("");
    const [shopeeAccessToken, setShopeeAccessToken] = useState("");
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [syncError, setSyncError] = useState("");

    const fetchConnectors = async () => {
        try {
            const data = await apiFetch("/connectors");
            setConnectors(data);
        } catch (err: any) {
            console.error("Failed to fetch connectors:", err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConnectors();
    }, []);

    // Polling mechanism if any connector is syncing
    useEffect(() => {
        const isSyncing = connectors.some(c => c.status === "syncing") || syncingId !== null;
        if (!isSyncing) return;

        const interval = setInterval(() => {
            fetchConnectors();
        }, 3000);

        return () => clearInterval(interval);
    }, [connectors, syncingId]);

    const handleInstallShopify = async (e: React.FormEvent) => {
        e.preventDefault();
        setInstallingShopify(true);
        try {
            // Basic sanitization
            const cleanDomain = shopDomain.replace(/https?:\/\//, "").trim();
            const res = await apiFetch("/connectors/shopify/install", {
                method: "POST",
                body: JSON.stringify({ shopDomain: cleanDomain }),
            });
            if (res.redirectUrl) {
                window.location.href = res.redirectUrl;
            }
        } catch (err: any) {
            alert(err.message || "Falha ao iniciar a instalação.");
            setInstallingShopify(false);
        }
    };

    const handleInstallMeli = async () => {
        setInstallingMeli(true);
        try {
            const res = await apiFetch("/connectors/meli/install", {
                method: "POST",
                body: JSON.stringify({ site: "MLB" }), // Default MVP Brazil
            });
            if (res.redirectUrl) {
                window.location.href = res.redirectUrl;
            }
        } catch (err: any) {
            alert(err.message || "Falha ao iniciar a instalação do Mercado Livre.");
            setInstallingMeli(false);
        }
    };

    const handleInstallShopee = async (e: React.FormEvent) => {
        e.preventDefault();
        setInstallingShopee(true);
        try {
            await apiFetch("/connectors/shopee/connect", {
                method: "POST",
                body: JSON.stringify({ shopId: shopeeShopId, accessToken: shopeeAccessToken }),
            });
            setShopeeShopId("");
            setShopeeAccessToken("");
            fetchConnectors();
        } catch (err: any) {
            alert(err.message || "Falha ao conectar loja Shopee.");
        } finally {
            setInstallingShopee(false);
        }
    };

    const handleSync = async (id: string) => {
        setSyncingId(id);
        setSyncError("");
        try {
            await apiFetch(`/connectors/${id}/sync`, { method: "POST" });
            fetchConnectors();
        } catch (err: any) {
            setSyncError(err.message || "Erro ao iniciar o sync");
        } finally {
            setTimeout(() => setSyncingId(null), 1000); // Give UI time to update
        }
    };

    const hasShopify = connectors.some(c => c.type === "shopify");
    const hasMeli = connectors.some(c => c.type === "mercadolivre");
    const hasShopee = connectors.some(c => c.type === "shopee");

    if (loading) {
        return <div className="p-8 text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin w-5 h-5" /> Carregando conectores...</div>;
    }

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <Plug className="w-8 h-8 text-blue-600" />
                    Integrações & Conectores
                </h1>
            </div>

            {justConnectedShopify && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                    <div>
                        <h3 className="font-medium">Shopify conectado com sucesso!</h3>
                        <p className="text-sm opacity-90">Sua loja já está autorizada. Clique em "Sincronizar agora" para baixar as devoluções.</p>
                    </div>
                </div>
            )}

            {justConnectedMeli && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-yellow-600" />
                    <div>
                        <h3 className="font-medium">Mercado Livre conectado com sucesso!</h3>
                        <p className="text-sm opacity-90">Sua conta de vendedor foi vinculada. Clique em "Sincronizar agora" para puxar as vendas e ocorrências.</p>
                    </div>
                </div>
            )}

            {!hasShopify && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                    <div className="border-b border-slate-100 bg-slate-50/50 p-6 flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-[#95BF47] flex items-center justify-center shrink-0">
                            <ShoppingBag className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-slate-900">Conectar Shopify</h2>
                            <p className="text-slate-500 mt-1">Importe automaticamente pedidos e reembolsos para alimentar o motor de risco de fraudes.</p>
                        </div>
                    </div>
                    <form onSubmit={handleInstallShopify} className="p-6">
                        <div className="max-w-md">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Domínio da Loja (.myshopify.com)
                            </label>
                            <input
                                type="text"
                                value={shopDomain}
                                onChange={(e) => setShopDomain(e.target.value)}
                                placeholder="sua-loja.myshopify.com"
                                className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                            <p className="text-xs text-slate-500 mt-2 mb-4">
                                Você será redirecionado para o painel do Shopify para conceder o acesso as permissões de leitura seguras (Pedidos e Devoluções).
                            </p>
                            <button
                                type="submit"
                                disabled={installingShopify || !shopDomain}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                            >
                                {installingShopify ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Conectar Shopify
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {!hasMeli && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                    <div className="border-b border-slate-100 bg-slate-50/50 p-6 flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-[#FFE600] flex items-center justify-center shrink-0">
                            <ShoppingBag className="w-6 h-6 text-slate-800" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-slate-900">Conectar Mercado Livre</h2>
                            <p className="text-slate-500 mt-1">Conecte sua conta de vendedor para analisar os estornos, devoluções parciais (mediações) e cancelar fraudes nativamente.</p>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="max-w-md">
                            <button
                                onClick={handleInstallMeli}
                                disabled={installingMeli}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFE600] text-slate-900 text-sm font-semibold rounded-lg hover:bg-[#F2DA00] disabled:opacity-50 transition-colors"
                            >
                                {installingMeli ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Conectar Conta MLB
                            </button>
                            <p className="text-xs text-slate-500 mt-3 inline-block ml-3">
                                Você será enviado ao Mercado Livre para login.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {!hasShopee && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
                    <div className="border-b border-slate-100 bg-slate-50/50 p-6 flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-[#EE4D2D] flex items-center justify-center shrink-0">
                            <ShoppingBag className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-slate-900">Conectar Shopee</h2>
                            <p className="text-slate-500 mt-1">Sincronize pedidos e rastreie devoluções (refunds/RTS) diretamente da API Shopee Open Platform.</p>
                        </div>
                    </div>
                    <form onSubmit={handleInstallShopee} className="p-6">
                        <div className="max-w-md space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Shop ID (Obrigatório)
                                </label>
                                <input
                                    type="text"
                                    value={shopeeShopId}
                                    onChange={(e) => setShopeeShopId(e.target.value)}
                                    placeholder="Ex: 5123498"
                                    className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Access Token (Opcional, depende do App)
                                </label>
                                <input
                                    type="password"
                                    value={shopeeAccessToken}
                                    onChange={(e) => setShopeeAccessToken(e.target.value)}
                                    placeholder="Cole o token de acesso (se houver)"
                                    className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">O Partner ID e Key devem estar configurados no backend.</p>
                            </div>

                            <button
                                type="submit"
                                disabled={installingShopee || !shopeeShopId}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-[#EE4D2D] text-white text-sm font-medium rounded-lg hover:bg-[#D74022] disabled:opacity-50 transition-colors"
                            >
                                {installingShopee ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Conectar Shopee
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-4">
                <h3 className="text-lg font-medium text-slate-900 mb-4">Conectores Ativos</h3>
                {connectors.length === 0 ? (
                    <p className="text-slate-500 text-sm italic">Nenhum conector ativo no momento.</p>
                ) : (
                    connectors.map(c => (
                        <div key={c.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${c.type === 'shopify' ? 'bg-[#95BF47]/10 text-[#95BF47]' : c.type === 'mercadolivre' ? 'bg-[#FFE600]/20 text-yellow-600' : c.type === 'shopee' ? 'bg-[#EE4D2D]/10 text-[#EE4D2D]' : 'bg-slate-100 text-slate-500'}`}>
                                    <ShoppingBag className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-semibold text-slate-900">{c.name}</h4>
                                    <p className="text-sm text-slate-500">{c.shop_domain}</p>

                                    <div className="flex items-center gap-4 mt-2">
                                        <div className="flex items-center gap-1.5">
                                            {c.status === "connected" && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" /> Conectado</span>}
                                            {c.status === "syncing" && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Sincronizando...</span>}
                                            {c.status === "error" && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"><AlertCircle className="w-3 h-3 mr-1" /> Erro</span>}
                                        </div>
                                        {c.last_sync_at && (
                                            <span className="text-xs text-slate-400">
                                                Último sync: {new Date(c.last_sync_at).toLocaleString()}
                                            </span>
                                        )}
                                    </div>

                                    {c.status === "error" && c.last_error && (
                                        <p className="text-xs text-red-600 mt-2 max-w-md truncate" title={c.last_error}>
                                            Erro: {c.last_error}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-2 shrink-0">
                                <button
                                    onClick={() => handleSync(c.id)}
                                    disabled={c.status === "syncing" || syncingId === c.id || ((user as any)?.role !== "owner" && (user as any)?.role !== "admin")}
                                    className="inline-flex items-center px-4 py-2 border border-slate-200 text-sm font-medium rounded-lg shadow-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                >
                                    <RefreshCw className={`w-4 h-4 mr-2 ${c.status === "syncing" || syncingId === c.id ? 'animate-spin' : ''}`} />
                                    Sincronizar agora
                                </button>
                                {syncError && <span className="text-xs text-red-500">{syncError}</span>}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

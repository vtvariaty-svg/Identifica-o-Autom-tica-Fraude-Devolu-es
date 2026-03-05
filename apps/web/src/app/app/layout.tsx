"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { usePathname } from "next/navigation";
import { LogOut, Home, Building, ShieldAlert, UploadCloud, ShoppingCart, ShieldCheck, TrendingUp, FileText, AlertTriangle, Plug, Upload } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { user, tenant, logout } = useAuth();
    const pathname = usePathname();

    const navLinks = [
        { name: "Início", href: "/app", icon: Home },
        { name: "Dashboard ROI", href: "/app/dashboard", icon: TrendingUp },
        { name: "Relatórios", href: "/app/reports", icon: FileText },
        { name: "Casos de Fraude", href: "/app/cases", icon: AlertTriangle },
        { name: "Conectores", href: "/app/connectors", icon: Plug },
        { name: "Devoluções", href: "/app/returns", icon: ShoppingCart },
        { name: "Importações CSV", href: "/app/imports", icon: UploadCloud },
        { name: "Tenants", href: "/app/tenants", icon: Building },
        { name: "Configurações (Anti-Fraude)", href: "/app/fraude", icon: ShieldAlert },
    ];

    return (
        <div className="flex h-screen bg-gray-100 font-sans text-gray-900">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
                <div className="h-16 flex items-center px-6 border-b border-gray-200">
                    <span className="text-xl font-bold text-blue-600 truncate">
                        {tenant?.name || "Sem Tenant Ativo"}
                    </span>
                </div>

                <nav className="flex-1 overflow-y-auto py-4">
                    <nav className="space-y-1">
                        {navLinks.map((link) => {
                            const Icon = link.icon;
                            return (
                                <Link
                                    key={link.name}
                                    href={link.href}
                                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${pathname === link.href || (link.href !== "/app" && pathname.startsWith(link.href))
                                        ? "bg-accent text-accent-foreground"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                        }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {link.name}
                                </Link>
                            );
                        })}
                    </nav>
                </nav>

                <div className="p-4 border-t border-gray-200">
                    <div className="text-sm font-medium truncate text-gray-700 mb-4 px-2">
                        {user?.email}
                    </div>
                    <button
                        onClick={logout}
                        className="flex items-center w-full px-2 py-2 text-sm font-medium text-red-600 rounded-md hover:bg-red-50"
                    >
                        <LogOut className="mr-3 h-5 w-5" />
                        Sair
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="h-16 flex items-center justify-between px-8 bg-white border-b border-gray-200 shadow-sm z-10">
                    <h1 className="text-xl font-semibold">Painel Administrativo</h1>

                    <div className="flex items-center gap-4">
                        {tenant ? (
                            <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full border border-green-200">
                                Tenant: {tenant.name}
                            </span>
                        ) : (
                            <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full border border-yellow-200">
                                Necessita selecionar Tenant
                            </span>
                        )}
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
                    {children}
                </div>
            </main>
        </div>
    );
}

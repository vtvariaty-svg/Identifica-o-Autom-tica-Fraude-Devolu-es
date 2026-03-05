"use client";

import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";
import { Building, ShieldCheck } from "lucide-react";

export default function AppHome() {
    const { user, tenant, role } = useAuth();

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
                    Olá, bem-vindo de volta!
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                    Você está logado como <span className="font-semibold text-gray-900">{user?.email}</span>
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {/* Tenant Card */}
                <div className="bg-white overflow-hidden shadow rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
                    <div className="p-5">
                        <div className="flex items-center">
                            <div className="flex-shrink-0">
                                <Building className="h-6 w-6 text-blue-500" />
                            </div>
                            <div className="ml-5 w-0 flex-1">
                                <dl>
                                    <dt className="text-sm font-medium text-gray-500 truncate">Tenant Atual</dt>
                                    <dd className="text-lg font-semibold text-gray-900">
                                        {tenant?.name || "Nenhum Selecionado"}
                                    </dd>
                                </dl>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-5 py-3">
                        <div className="text-sm">
                            <Link href="/app/tenants" className="font-medium text-blue-600 hover:text-blue-900 transition-colors">
                                Gerenciar Tenants &rarr;
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Role Card */}
                <div className="bg-white overflow-hidden shadow rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
                    <div className="p-5">
                        <div className="flex items-center">
                            <div className="flex-shrink-0">
                                <ShieldCheck className="h-6 w-6 text-emerald-500" />
                            </div>
                            <div className="ml-5 w-0 flex-1">
                                <dl>
                                    <dt className="text-sm font-medium text-gray-500 truncate">Sua Permissão</dt>
                                    <dd className="text-lg font-semibold text-gray-900 capitalize">
                                        {role || "N/A"}
                                    </dd>
                                </dl>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-5 py-3">
                        <div className="text-sm">
                            <span className="text-gray-500 font-medium">RBAC Ativo</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

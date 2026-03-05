"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Role = "owner" | "admin" | "analyst";

interface AuthUser {
    id: string;
    email: string;
}

interface AuthTenant {
    id: string;
    name: string;
    slug: string;
}

interface AuthContextType {
    user: AuthUser | null;
    tenant: AuthTenant | null;
    role: Role | null;
    loading: boolean;
    logout: () => Promise<void>;
    refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    tenant: null,
    role: null,
    loading: true,
    logout: async () => { },
    refreshSession: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [tenant, setTenant] = useState<AuthTenant | null>(null);
    const [role, setRole] = useState<Role | null>(null);
    const [loading, setLoading] = useState(true);

    const router = useRouter();
    const pathname = usePathname();

    const fetchSession = async () => {
        try {
            const data = await apiFetch("/auth/me");
            setUser(data.user);
            setTenant(data.tenant);
            setRole(data.role);
        } catch (err) {
            setUser(null);
            setTenant(null);
            setRole(null);

            // If we are in the protected /app area and the fetch failed, kick out
            if (pathname.startsWith("/app")) {
                router.push("/login");
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSession();
    }, [pathname]);

    const logout = async () => {
        try {
            await apiFetch("/auth/logout", { method: "POST" });
        } catch (e) { }
        setUser(null);
        setTenant(null);
        setRole(null);
        router.push("/login");
    };

    if (loading && pathname.startsWith("/app")) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Caregando sessão...</div>;
    }

    // Guard mechanism for direct rendering isolation
    if (!user && pathname.startsWith("/app") && !loading) {
        return null; // The useEffect redirect will handle the navigation smoothly
    }

    return (
        <AuthContext.Provider value={{ user, tenant, role, loading, logout, refreshSession: fetchSession }}>
            {children}
        </AuthContext.Provider>
    );
}

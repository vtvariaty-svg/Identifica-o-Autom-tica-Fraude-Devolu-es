export interface EnvVars {
    NODE_ENV: "development" | "staging" | "production";
    PORT?: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    LOG_LEVEL?: string;
    JWT_SECRET: string;
    COOKIE_DOMAIN?: string;
    COOKIE_SECURE?: string;
}

export type JobPayload = {
    startedAt: string;
    payload: any;
};

// Tenant & Auth core types
export type Role = "owner" | "admin" | "analyst";

export interface UserDTO {
    id: string;
    email: string;
}

export interface TenantDTO {
    id: string;
    name: string;
    slug: string;
}

export interface AuthSession {
    userId: string;
    tenantId: string | null;
    role: Role | null;
}

export interface MeResponse {
    user: UserDTO;
    tenant: TenantDTO | null;
    role: Role | null;
}

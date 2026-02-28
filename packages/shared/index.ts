export interface EnvVars {
    NODE_ENV: "development" | "staging" | "production";
    PORT?: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    LOG_LEVEL?: string;
}

export type JobPayload = {
    startedAt: string;
    payload: any;
};

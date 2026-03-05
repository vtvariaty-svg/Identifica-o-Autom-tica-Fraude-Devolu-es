import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export function initSentry() {
    if (process.env.SENTRY_DSN) {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.SENTRY_ENVIRONMENT || "development",
            release: process.env.SENTRY_RELEASE || "1.0.0",
            integrations: [
                nodeProfilingIntegration(),
                Sentry.httpIntegration(),
            ],
            // Performance Monitoring
            tracesSampleRate: 1.0,
            // Profiling
            profilesSampleRate: 1.0,
        });
        console.log("Sentry API Initialized!");
    }
}

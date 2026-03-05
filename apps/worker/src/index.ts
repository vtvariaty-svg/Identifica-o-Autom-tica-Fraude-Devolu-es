import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import IORedis from "ioredis";
import importCsvJob from "./jobs/import_csv.job";
import computeFeaturesJob from "./jobs/compute_features_for_return.job";
import computeRiskScoreJob from "./jobs/compute_risk_score_for_return.job";
import shopifySyncJob from "./jobs/shopify_sync.job";
import meliSyncJob from "./jobs/meli_sync.job";
import shopeeSyncJob from "./jobs/shopee_sync.job";
import { initSentry } from "./sentry";
import * as Sentry from "@sentry/node";

dotenv.config();

initSentry();

const connection = new IORedis(process.env.REDIS_URL || "", {
    maxRetriesPerRequest: null,
});

if (!process.env.DATABASE_URL) {
    console.error("CRITICAL ERROR: DATABASE_URL is not defined in environment variables for Worker.");
    process.exit(1);
}

const prisma = new PrismaClient();

async function start() {
    console.log("Worker starting...");

    try {
        await prisma.$queryRaw`SELECT 1`;
        console.log("Worker connected to Postgres database.");
    } catch (error) {
        console.error("Worker failed to connect to Postgres:", error);
        process.exit(1);
    }

    const worker = new Worker(
        "jobs",
        async (job) => {
            console.log(`[Worker] Executing job ${job.id} of type ${job.name} (Attempt ${job.attemptsMade + 1})`);

            try {
                switch (job.name) {
                    case "import_csv":
                        return await importCsvJob(job);
                    case "compute_features_for_return":
                        return await computeFeaturesJob(job);
                    case "compute_risk_score_for_return":
                        return await computeRiskScoreJob(job);
                    case "shopify_sync":
                        return await shopifySyncJob(job);
                    case "meli_sync":
                        return await meliSyncJob(job);
                    case "shopee_sync":
                        return await shopeeSyncJob(job);
                    default:
                        console.log(`[Worker] Unknown Job Data:`, job.data);
                        return { success: true, processedAt: new Date().toISOString() };
                }
            } catch (error) {
                Sentry.withScope((scope) => {
                    scope.setTag("job_id", job.id);
                    scope.setTag("job_name", job.name);
                    if (job.data?.tenantId) scope.setTag("tenant_id", job.data.tenantId);
                    if (job.data?.importRunId) scope.setTag("import_run_id", job.data.importRunId);
                    Sentry.captureException(error);
                });
                throw error;
            }
        },
        {
            connection: connection as any,
            concurrency: process.env.WORKER_CONCURRENCY ? parseInt(process.env.WORKER_CONCURRENCY) : 5,
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 } // Keep failed for inspection as DLQ
        }
    );

    worker.on("ready", () => {
        console.log("Worker connected to Redis and ready to process jobs.");
    });

    worker.on("completed", (job) => {
        console.log(`[WORKER] Job ${job.id} has completed!`);
    });

    worker.on("failed", async (job, err) => {
        console.error(`[WORKER] Job ${job?.id} has failed with ${err.message}`);

        // Permanent failure (exhausted attempts)
        if (job && job.attemptsMade >= job.opts.attempts!) {
            console.error(`[WORKER] Job ${job.id} PERMANENTLY FAILED after ${job.attemptsMade} attempts.`);

            Sentry.withScope((scope) => {
                scope.setTag("dead_letter", "true");
                scope.setTag("job_name", job.name);
                if (job.data?.tenantId) scope.setTag("tenant_id", job.data.tenantId);
                Sentry.captureException(new Error(`Worker Job Dead-Letter: ${job.name} failed permanently`));
            });

            // If it's linked to an import run, mark it failed explicitly
            if (job.data && job.data.importRunId && job.data.tenantId) {
                try {
                    await prisma.importRun.update({
                        where: { id: job.data.importRunId },
                        data: { status: "failed", updated_at: new Date() }
                    });

                    await prisma.importError.create({
                        data: {
                            tenant_id: job.data.tenantId,
                            import_run_id: job.data.importRunId,
                            message: `permanent_failure: ${err.message}`,
                            payload: job.data
                        }
                    });
                } catch (dbErr) {
                    console.error("Failed to write to dead-letter ImportError:", dbErr);
                }
            }
        }
    });
}

start();

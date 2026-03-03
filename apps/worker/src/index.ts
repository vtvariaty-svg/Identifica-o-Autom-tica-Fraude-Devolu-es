import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import IORedis from "ioredis";
import importCsvJob from "./jobs/import_csv.job";
import computeFeaturesForReturnJob from "./jobs/compute_features_for_return.job";
import computeRiskScoreForReturnJob from "./jobs/compute_risk_score_for_return.job";

dotenv.config();

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
            console.log(`[Worker] Executing job ${job.id} of type ${job.name}`);

            if (job.name === "import_csv") {
                return await importCsvJob(job);
            }

            if (job.name === "compute_features_for_return") {
                return await computeFeaturesForReturnJob(job);
            }

            if (job.name === "compute_risk_score_for_return") {
                return await computeRiskScoreForReturnJob(job);
            }

            console.log(`[Worker] Data:`, job.data);
            return { success: true, processedAt: new Date().toISOString() };
        },
        { connection: connection as any }
    );

    worker.on("ready", () => {
        console.log("Worker connected to Redis and ready to process jobs.");
    });

    worker.on("completed", (job) => {
        console.log(`[WORKER] Job ${job.id} has completed!`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[WORKER] Job ${job?.id} has failed with ${err.message}`);
    });
}

start();

import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const connection = {
    url: process.env.REDIS_URL || "redis://localhost:6379",
};

if (!process.env.DATABASE_URL) {
    console.error("CRITICAL ERROR: DATABASE_URL is not defined in environment variables for Worker.");
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
            console.log(`[WORKER] PROCESSANDO JOB TESTE: ${job.id}`, job.data);

            try {
                await prisma.$queryRaw`SELECT 1`;
                console.log(`[WORKER] Job ${job.id} verified DB connection successfully.`);
            } catch (err) {
                console.error(`[WORKER] DB check failed during job ${job.id}:`, err);
                throw err;
            }

            return { success: true, processedAt: new Date().toISOString() };
        },
        { connection }
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

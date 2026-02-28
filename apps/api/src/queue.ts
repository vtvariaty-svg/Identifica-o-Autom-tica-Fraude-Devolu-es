import { Queue } from "bullmq";
import * as dotenv from "dotenv";
dotenv.config();

const connection = {
    url: process.env.REDIS_URL || "redis://localhost:6379",
};

export const testQueue = new Queue("jobs", { connection });

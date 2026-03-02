import { Queue } from "bullmq";
import * as dotenv from "dotenv";
dotenv.config();

const connection = {
    url: process.env.REDIS_URL,
};

export const testQueue = new Queue("jobs", { connection: connection as any });


import { Queue } from "bullmq";
import * as dotenv from "dotenv";
dotenv.config();

const connection = {
    url: process.env.REDIS_URL,
};
export const testQueue = new Queue("jobs", {
    connection: connection as any,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 60000 // 1 minute initially, then 2m, 4m...
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
    }
});


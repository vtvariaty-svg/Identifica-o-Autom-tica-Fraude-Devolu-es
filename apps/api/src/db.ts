import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

export const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

if (!process.env.DATABASE_URL) {
    console.error("CRITICAL ERROR: DATABASE_URL is not defined in environment variables.");
    console.error("Please ensure you have set this variable in the Render Dashboard -> Environment section.");
}

export const prisma = new PrismaClient();


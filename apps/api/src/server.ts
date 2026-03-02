import Fastify from "fastify";
import cors from "@fastify/cors";
import { v4 as uuidv4 } from "uuid";
import { testQueue } from "./queue";
import { prisma } from "./db";
import fastifyCookie from "@fastify/cookie";
import authRoutes from "./routes/auth.routes";
import tenantRoutes from "./routes/tenant.routes";

const server = Fastify({
    logger: {
        level: process.env.LOG_LEVEL || "info",
    },
    genReqId: () => uuidv4(),
});

server.register(cors, {
    origin: true, // Allow request origin
    credentials: true, // Allow cookies
});

server.register(fastifyCookie);

server.register(authRoutes);
server.register(tenantRoutes);

server.setErrorHandler((error, request, reply) => {
    server.log.error(error);
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

server.get("/", async (request, reply) => {
    return { service: "api", version: "1.0.0" };
});

server.get("/health", async (request, reply) => {
    return {
        status: "ok",
        env: process.env.NODE_ENV,
        ts: new Date().toISOString(),
    };
});

server.get("/db/ping", async (request, reply) => {
    try {
        const result = await prisma.$queryRaw`SELECT 1 as ping`;
        return { db: "ok", result };
    } catch (error) {
        server.log.error(error);
        reply.status(500).send({ error: "Failed to connect to database" });
    }
});

server.post("/queue/test", async (request, reply) => {
    try {
        const job = await testQueue.add("teste", {
            startedAt: new Date().toISOString(),
            payload: request.body || {},
        });
        return { queued: true, jobId: job.id };
    } catch (error) {
        server.log.error(error);
        reply.status(500).send({ error: "Failed to queue job" });
    }
});

const start = async () => {
    try {
        const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
        await server.listen({ port, host: "0.0.0.0" });
        console.log(`API running on port ${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();

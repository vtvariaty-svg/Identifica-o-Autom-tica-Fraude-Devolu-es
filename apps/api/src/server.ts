import Fastify from "fastify";
import cors from "@fastify/cors";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { testQueue } from "./queue";
import { prisma } from "./db";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import authRoutes from "./routes/auth.routes";
import tenantRoutes from "./routes/tenant.routes";
import orderRoutes from "./routes/order.routes";
import returnRoutes from "./routes/return.routes";
import featuresRoutes from "./routes/features.routes";
import importRoutes from "./routes/import.routes";
import casesRoutes from "./routes/cases.routes";
import { metricsRoutes } from "./routes/metrics.routes";
import { connectorsRoutes } from "./routes/connectors.routes";
import { initSentry } from "./sentry";
import * as Sentry from "@sentry/node";

initSentry();

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
server.register(fastifyMultipart, {
    limits: {
        fileSize: 10 * 1024 * 1024, // Limit to 10MB MVP
    }
});

const redisRateLimit = new Redis(process.env.REDIS_URL || "", { maxRetriesPerRequest: null });

server.register(fastifyRateLimit, {
    max: 120, // default global limit
    timeWindow: '1 minute',
    redis: redisRateLimit,
    keyGenerator: (request) => {
        // Rate limit by tenant_id if authenticated
        if (request.auth && request.auth.tenantId && request.auth.tenantId !== "system") {
            return `tenant:${request.auth.tenantId}`;
        }
        // Fallback to IP address
        return `ip:${request.ip}`;
    },
    errorResponseBuilder: (request, context) => {
        return {
            error: {
                code: "RATE_LIMIT",
                message: "Too many requests. Please try again later.",
                details: {
                    limit: context.max,
                    window: context.after
                }
            }
        };
    }
});

server.register(authRoutes, { prefix: "/auth" });
server.register(tenantRoutes, { prefix: "/tenants" });
server.register(orderRoutes, { prefix: "/orders" });
server.register(returnRoutes, { prefix: "/returns" });
server.register(featuresRoutes, { prefix: "/returns" });
server.register(importRoutes, { prefix: "/imports" });
server.register(casesRoutes, { prefix: "/cases" });
server.register(metricsRoutes, { prefix: "/metrics" });
server.register(connectorsRoutes, { prefix: "/connectors" });

server.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
});

server.setErrorHandler((error, request, reply) => {
    server.log.error({ err: error, reqId: request.id }, error.message);

    Sentry.withScope(scope => {
        scope.setTag("request_id", request.id);
        if (request.auth) {
            scope.setTag("tenant_id", request.auth.tenantId);
            scope.setUser({ id: request.auth.userId });
        }
        Sentry.captureException(error);
    });

    if (error instanceof z.ZodError) {
        return reply.status(400).send({
            error: {
                code: "VALIDATION_ERROR",
                message: "Invalid request payload or parameters",
                details: error.issues
            }
        });
    }

    if (error.statusCode === 429) {
        return reply.status(429).send({
            error: {
                code: "RATE_LIMIT",
                message: "Too many requests. Please try again later.",
            }
        });
    }

    const statusCode = error.statusCode || 500;
    const code = statusCode === 401 || statusCode === 403 ? "FORBIDDEN" : statusCode === 404 ? "NOT_FOUND" : "INTERNAL";

    reply.status(statusCode).send({
        error: {
            code,
            message: statusCode === 500 ? "Internal Server Error" : error.message
        }
    });
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

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard } from "../plugins/auth";
import { testQueue } from "../queue";

export const importRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    // Endpoint 1: Upload CSV and enqueue job
    app.post("/csv", async (request, reply) => {
        const data = await request.file();

        if (!data) {
            return reply.status(400).send({ error: "Missing file" });
        }

        // We also expect entityType in the form data
        // fields are available on data.fields after consuming the file
        const fileBuffer = await data.toBuffer();

        let entityType = "orders"; // default fallback
        if (data.fields.entityType && "value" in data.fields.entityType) {
            entityType = data.fields.entityType.value as string;
        }

        const validEntities = ["customers", "orders", "order_items", "returns", "return_items"];
        if (!validEntities.includes(entityType)) {
            return reply.status(400).send({ error: `Invalid entityType. Must be one of: ${validEntities.join(", ")}` });
        }

        const { tenantId } = request.auth!;

        // 1. Create ImportRun with file embedded
        const importRun = await prisma.importRun.create({
            data: {
                tenant_id: tenantId,
                status: "queued",
                entity_type: entityType,
                file_name: data.filename,
                file_mime: data.mimetype,
                file_bytes: fileBuffer,
            }
        });

        // 2. Enqueue Background Job
        await testQueue.add("import_csv", { importRunId: importRun.id });

        return reply.status(202).send({
            message: "File uploaded and import queued successfully",
            importRunId: importRun.id
        });
    });

    // Endpoint 2: List Import History
    app.get("/", async (request, reply) => {
        const { tenantId } = request.auth!;

        const runs = await prisma.importRun.findMany({
            where: { tenant_id: tenantId },
            orderBy: { created_at: "desc" },
            take: 50,
            select: { // Exclude file_bytes out of payload
                id: true,
                status: true,
                entity_type: true,
                file_name: true,
                total_rows: true,
                success_rows: true,
                error_rows: true,
                created_at: true,
                finished_at: true,
            }
        });

        return reply.send({ data: runs });
    });

    // Endpoint 3: Import Details
    app.get("/:id", async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const { id } = paramsSchema.parse(request.params);
        const tenantId = request.auth!.tenantId!;

        const run = await prisma.importRun.findFirst({
            where: { id, tenant_id: tenantId },
            select: {
                id: true,
                status: true,
                entity_type: true,
                file_name: true,
                total_rows: true,
                success_rows: true,
                error_rows: true,
                started_at: true,
                finished_at: true,
                summary: true,
                created_at: true,
            }
        });

        if (!run) {
            return reply.status(404).send({ error: "Import run not found" });
        }

        return reply.send(run);
    });

    // Endpoint 4: Import Errors list
    app.get("/:id/errors", async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const querySchema = z.object({
            limit: z.coerce.number().min(1).max(100).default(50),
            offset: z.coerce.number().min(0).default(0),
        });

        const { id } = paramsSchema.parse(request.params);
        const { limit, offset } = querySchema.parse(request.query);
        const tenantId = request.auth!.tenantId!;

        // 1. Validate run access
        const run = await prisma.importRun.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true }
        });

        if (!run) {
            return reply.status(404).send({ error: "Import run not found" });
        }

        // 2. Fetch specific errors
        const errors = await prisma.importError.findMany({
            where: { import_run_id: id, tenant_id: tenantId },
            orderBy: { line_number: "asc" },
            skip: offset,
            take: limit,
        });

        const total = await prisma.importError.count({
            where: { import_run_id: id, tenant_id: tenantId },
        });

        return reply.send({
            data: errors,
            meta: { total, limit, offset }
        });
    });
};

export default importRoutes;

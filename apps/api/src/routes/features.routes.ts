import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { authGuard, tenantIsolationGuard } from "../plugins/auth";
import { testQueue } from "../queue";

export const featuresRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", authGuard);
    app.addHook("onRequest", tenantIsolationGuard);

    // Endpoint 1: Fetch Return Details + Features Snapshot
    app.get("/:id/details", async (request, reply) => {
        const paramsSchema = z.object({ id: z.string().uuid() });
        const { id } = paramsSchema.parse(request.params);
        const tenantId = request.auth!.tenantId!;

        const returnDetails = await prisma.return.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                order: {
                    include: { customer: true }
                },
                items: true,
            }
        });

        if (!returnDetails) {
            return reply.status(404).send({ error: "Return not found" });
        }

        const latestSnapshot = await prisma.featuresSnapshot.findFirst({
            where: { return_id: id, tenant_id: tenantId },
            orderBy: { computed_at: "desc" } as any,
        });

        return reply.send({
            return: returnDetails,
            order: returnDetails.order,
            features: latestSnapshot ? (latestSnapshot as any).features_json : null,
            featuresComputedAt: latestSnapshot ? (latestSnapshot as any).computed_at : null,
            featuresStatus: latestSnapshot ? "ok" : "missing",
        });
    });

    // Endpoint 2: Compute Features (Queue Job)
    app.post("/:id/compute-features", async (request, reply) => {
        // Enforce RBAC manually for OWNER or ADMIN without relying on roleGuard helper to simplify
        const userRole = request.auth!.role;
        if (userRole !== "OWNER" && userRole !== "ADMIN") {
            return reply.status(403).send({ error: "Insufficient privileges to compute features" });
        }

        const paramsSchema = z.object({ id: z.string().uuid() });
        const { id } = paramsSchema.parse(request.params);
        const tenantId = request.auth!.tenantId!;

        const returnCheck = await prisma.return.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true }
        });

        if (!returnCheck) {
            return reply.status(404).send({ error: "Return not found to compute features" });
        }

        // Add to Queue
        await testQueue.add("compute_features_for_return", { tenantId, returnId: id });

        return reply.status(202).send({
            queued: true,
            message: "Feature computation job enrolled in background queue.",
            returnId: id
        });
    });
};

export default featuresRoutes;

import { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

export default async function importCsvJob(job: Job) {
    const { importRunId } = job.data;
    if (!importRunId) throw new Error("Missing importRunId");

    // 1. Fetch the run
    const run = await prisma.importRun.findUnique({
        where: { id: importRunId }
    });

    if (!run || !(run as any).file_bytes) {
        throw new Error("Import run or file contents not found");
    }

    // 2. Mark as running
    await prisma.importRun.update({
        where: { id: importRunId },
        data: { status: "running", started_at: new Date() }
    });

    try {
        // 3. Parse CSV
        const fileContent = (run as any).file_bytes.toString("utf-8");
        // Simple heuristic to detect delimiter
        const delimiter = fileContent.split("\n")[0]?.includes(";") ? ";" : ",";

        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            delimiter,
            // Trim spaces around headers and values
            trim: true,
        });

        let successCount = 0;
        let errorCount = 0;

        // 4. Process each row
        for (let i = 0; i < records.length; i++) {
            const row = records[i];
            const lineNumber = i + 2; // +1 for 0-index, +1 for header

            try {
                await processRow(run.tenant_id, (run as any).entity_type, row);
                successCount++;
            } catch (error: any) {
                errorCount++;
                // 5. Register Error for the line
                await prisma.importError.create({
                    data: {
                        tenant_id: run.tenant_id,
                        import_run_id: run.id,
                        message: error.message || "Unknown error parsing line",
                        ...({
                            line_number: lineNumber,
                            entity_type: (run as any).entity_type,
                            external_id: String((row as any).external_id || ""),
                            payload: row as any, // snapshot of the offending row
                        } as any)
                    }
                });
            }
        }

        // 6. Finalize Run
        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: "success",
                finished_at: new Date(),
                summary: {
                    message: "Completed processing. Check errors if error_rows > 0.",
                },
                ...({
                    total_rows: records.length,
                    success_rows: successCount,
                    error_rows: errorCount,
                } as any)
            }
        });

        return { success: true, total: records.length, successCount, errorCount };

    } catch (e: any) {
        // Systemic failure (e.g. invalid CSV format)
        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: "failed",
                finished_at: new Date(),
                summary: { error: e.message || "System error parsing file" }
            }
        });
        throw e;
    }
}

async function processRow(tenantId: string, entityType: string, row: any) {
    if (entityType === "customers") {
        if (!row.external_id) throw new Error("external_id is required for customers");

        const payloadJson = row.metadata_json ? JSON.parse(row.metadata_json) : {};

        await prisma.customer.upsert({
            where: { tenant_id_external_id: { tenant_id: tenantId, external_id: row.external_id } },
            update: {
                email: row.email || undefined,
                name: row.name || undefined,
                phone: row.phone || undefined,
                document: row.document || undefined,
                metadata: payloadJson,
            },
            create: {
                tenant_id: tenantId,
                external_id: row.external_id,
                email: row.email,
                name: row.name,
                phone: row.phone,
                document: row.document,
                metadata: payloadJson,
            }
        });
    }
    else if (entityType === "orders") {
        if (!row.external_id) throw new Error("external_id is required for orders");

        let customerId = undefined;
        // Resolve customer if provided
        if (row.customer_external_id) {
            let cust = await prisma.customer.findUnique({
                where: { tenant_id_external_id: { tenant_id: tenantId, external_id: String(row.customer_external_id) } }
            });
            if (!cust) {
                // Create placeholder customer
                cust = await prisma.customer.create({
                    data: {
                        tenant_id: tenantId,
                        external_id: String(row.customer_external_id),
                        name: "Created by Order Import",
                        metadata: { createdByImport: true }
                    }
                });
            }
            customerId = cust.id;
        }

        const placedAt = row.placed_at ? new Date(row.placed_at) : new Date();
        const totalCents = row.total_cents ? parseInt(row.total_cents, 10) : 0;
        const payloadJson = row.raw_payload_json ? JSON.parse(row.raw_payload_json) : {};

        // Upsert by external ID (manually using findFirst because id is the PK, not external_id)
        const existingOrder = await prisma.order.findFirst({
            where: { tenant_id: tenantId, external_id: row.external_id }
        });

        if (existingOrder) {
            await prisma.order.update({
                where: { id: existingOrder.id },
                data: {
                    status: row.status || undefined,
                    total_cents: totalCents,
                    currency: row.currency || undefined,
                    customer_id: customerId,
                    placed_at: placedAt,
                    raw_payload: payloadJson,
                }
            });
        } else {
            await prisma.order.create({
                data: {
                    tenant_id: tenantId,
                    external_id: row.external_id,
                    status: row.status || "created",
                    total_cents: totalCents,
                    currency: row.currency || "BRL",
                    customer_id: customerId,
                    placed_at: placedAt,
                    raw_payload: payloadJson,
                }
            });
        }
    }
    else if (entityType === "returns") {
        if (!row.external_id) throw new Error("external_id is required for returns");
        if (!row.order_external_id) throw new Error("order_external_id is required for returns");

        const order = await prisma.order.findFirst({
            where: { tenant_id: tenantId, external_id: row.order_external_id }
        });

        if (!order) throw new Error(`Linked order not found: ${row.order_external_id}`);

        const reqAt = row.requested_at ? new Date(row.requested_at) : new Date();
        const refundAmt = row.refund_amount_cents ? parseInt(row.refund_amount_cents, 10) : 0;

        const existingReturn = await prisma.return.findFirst({
            where: { tenant_id: tenantId, external_id: row.external_id }
        });

        if (existingReturn) {
            await prisma.return.update({
                where: { id: existingReturn.id },
                data: {
                    status: row.status || undefined,
                    reason: row.reason || undefined,
                    refund_amount_cents: refundAmt,
                    requested_at: reqAt,
                }
            });
        } else {
            await prisma.return.create({
                data: {
                    tenant_id: tenantId,
                    external_id: row.external_id,
                    order_id: order.id,
                    status: row.status || "requested",
                    reason: row.reason,
                    refund_amount_cents: refundAmt,
                    requested_at: reqAt,
                }
            });
        }
    }
    else {
        throw new Error(`Unsupported entityType for CSV ingest: ${entityType}`);
    }
}

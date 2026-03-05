import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import crypto from 'crypto';

const prisma = new PrismaClient();

const connection = new IORedis(process.env.REDIS_URL || "", {
    maxRetriesPerRequest: null,
});

// Reuse the compute queue from the worker side
const computeQueue = new Queue("jobs", { connection: connection as any });

function decryptToken(enc: string, iv: string, tag: string) {
    const ALGO = 'aes-256-gcm';
    const b64 = process.env.ENCRYPTION_KEY_BASE64;
    if (!b64) throw new Error("Missing ENCRYPTION_KEY_BASE64 in env");
    const key = Buffer.from(b64, 'base64');

    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    let plain = decipher.update(enc, 'base64', 'utf8');
    plain += decipher.final('utf8');
    return plain;
}

export default async function shopifySyncJob(job: Job) {
    const { tenantId, connectorId, importRunId } = job.data as { tenantId: string, connectorId: string, importRunId: string };

    // 1. Mark running
    await prisma.importRun.update({
        where: { id: importRunId },
        data: { status: "running" }
    });

    let errorsCount = 0;
    let ordersUpserted = 0;
    let returnsUpserted = 0;
    let shopDomain = "";
    let sinceStr = "";
    const affectedReturnIds: string[] = [];

    try {
        const connectorResult = await prisma.connector.findUnique({ where: { id: connectorId } });
        const connector = connectorResult as any;
        if (!connector || connector.type !== "shopify" || connector.status !== "connected") {
            throw new Error("Invalid or disconnected connector.");
        }

        shopDomain = connector.shop_domain;
        const accessToken = decryptToken(connector.access_token_enc, connector.access_token_iv, connector.access_token_tag);

        const since = connector.last_sync_at || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
        sinceStr = since.toISOString();
        const shopifyQuery = `updated_at:>=${since.toISOString()}`;

        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage) {
            const gql = `
            query getOrders($query: String!, $cursor: String) {
                orders(first: 50, after: $cursor, query: $query) {
                    pageInfo { hasNextPage endCursor }
                    nodes {
                        id
                        createdAt
                        updatedAt
                        totalPriceSet { shopMoney { amount currencyCode } }
                        customer { id email phone firstName lastName }
                        lineItems(first: 50) {
                            nodes { id sku name quantity originalUnitPriceSet { shopMoney { amount } } }
                        }
                        refunds(first: 50) {
                            nodes {
                                id
                                createdAt
                                note
                                totalRefundedSet { shopMoney { amount } }
                                refundLineItems(first: 50) {
                                    nodes { quantity lineItem { id } }
                                }
                            }
                        }
                    }
                }
            }`;

            const res: any = await fetch(`https://${shopDomain}/admin/api/2024-04/graphql.json`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": accessToken
                },
                body: JSON.stringify({ query: gql, variables: { query: shopifyQuery, cursor } })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Shopify API Error: ${errText}`);
            }

            const json: any = await res.json();
            if (json.errors) {
                throw new Error(`Shopify GraphQL Error: ${JSON.stringify(json.errors)}`);
            }

            const ordersPage: any = json.data.orders;
            hasNextPage = ordersPage.pageInfo.hasNextPage;
            cursor = ordersPage.pageInfo.endCursor;

            // Process payload
            for (const order of ordersPage.nodes) {
                try {
                    // Upsert Customer
                    let customerId = null;
                    if (order.customer) {
                        const cust = await prisma.customer.upsert({
                            where: { tenant_id_external_id: { tenant_id: tenantId, external_id: order.customer.id } },
                            create: {
                                tenant_id: tenantId,
                                external_id: order.customer.id,
                                email: order.customer.email,
                                phone: order.customer.phone,
                                name: `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
                            },
                            update: {
                                email: order.customer.email,
                                phone: order.customer.phone,
                                name: `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
                            }
                        });
                        customerId = cust.id;
                    }

                    const dbOrderResult = await prisma.order.upsert({
                        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: order.id } } as any,
                        create: {
                            tenant_id: tenantId,
                            external_id: order.id,
                            connector_id: connectorId,
                            customer_id: customerId,
                            status: "processed", // Default simple mapped status
                            total_cents: Math.round(parseFloat(order.totalPriceSet.shopMoney.amount) * 100),
                            currency: order.totalPriceSet.shopMoney.currencyCode,
                            placed_at: new Date(order.createdAt),
                            raw_payload: order // Stores essential JSON
                        },
                        update: {
                            total_cents: Math.round(parseFloat(order.totalPriceSet.shopMoney.amount) * 100),
                            status: "processed",
                            raw_payload: order as any
                        }
                    });
                    const dbOrder = dbOrderResult as any;
                    ordersUpserted++;

                    // Upsert Line Items
                    const orderItemMap = new Map<string, string>(); // Shopify LineItem ID => DB OrderItem ID
                    for (const li of order.lineItems.nodes) {
                        const dbLi = await prisma.orderItem.create({
                            data: {
                                tenant_id: tenantId,
                                order_id: dbOrder.id,
                                external_id: li.id,
                                sku: li.sku,
                                product_name: li.name,
                                quantity: li.quantity,
                                unit_price_cents: Math.round(parseFloat(li.originalUnitPriceSet?.shopMoney?.amount || "0") * 100)
                            }
                        });
                        orderItemMap.set(li.id, dbLi.id);
                    }

                    for (const refund of order.refunds.nodes) {
                        const externalRefundId = `refund:${refund.id}`;
                        const dbReturnResult = await prisma.return.upsert({
                            where: { tenant_id_external_id: { tenant_id: tenantId, external_id: externalRefundId } } as any,
                            create: {
                                tenant_id: tenantId,
                                external_id: externalRefundId,
                                order_id: dbOrder.id,
                                connector_id: connectorId,
                                status: "refunded",
                                refund_amount_cents: Math.round(parseFloat(refund.totalRefundedSet.shopMoney.amount) * 100),
                                requested_at: new Date(refund.createdAt),
                                reason: refund.note || "Shopify Refund",
                                raw_payload: refund as any
                            },
                            update: {
                                refund_amount_cents: Math.round(parseFloat(refund.totalRefundedSet.shopMoney.amount) * 100),
                            }
                        });
                        const dbReturn = dbReturnResult as any;

                        // Upsert Return Items
                        for (const rli of refund.refundLineItems.nodes) {
                            const orderItemId = orderItemMap.get(rli.lineItem.id);
                            await prisma.returnItem.create({
                                data: {
                                    tenant_id: tenantId,
                                    return_id: dbReturn.id,
                                    order_item_id: orderItemId || null,
                                    quantity: rli.quantity
                                }
                            });
                        }

                        returnsUpserted++;
                        if (!affectedReturnIds.includes(dbReturn.id)) {
                            affectedReturnIds.push(dbReturn.id);
                        }
                    }

                } catch (rowErr: any) {
                    errorsCount++;
                    await prisma.importError.create({
                        data: {
                            tenant_id: tenantId,
                            import_run_id: importRunId,
                            external_id: order.id,
                            message: rowErr.message || "Failed to upsert order",
                            payload: { error: rowErr.message, stage: "orders" } as any
                        }
                    });
                }
            }
        }

        // Finalize
        await (prisma.connector as any).update({
            where: { id: connectorId },
            data: {
                status: "connected",
                last_sync_at: new Date()
            }
        });

        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: errorsCount > 0 ? "success" : "success", // success with errors vs full success
                error_rows: errorsCount,
                success_rows: ordersUpserted + returnsUpserted,
                finished_at: new Date(),
                summary: { orders_upserted: ordersUpserted, returns_upserted: returnsUpserted, errors: errorsCount, shop_domain: shopDomain, since: sinceStr } as any
            }
        });

        // Enqueue feature + score pipeline for affected returns
        for (const retId of affectedReturnIds) {
            await computeQueue.add("compute_features_for_return", { returnId: retId, tenantId });
            // Score follows natively in the pipeline of calculate features
        }

        return { success: true, processedReturns: affectedReturnIds.length };

    } catch (error: any) {
        console.error("Shopify Sync Global Error:", error);

        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: "failed",
                error_rows: errorsCount + 1,
                finished_at: new Date(),
                summary: { error: error.message, shop_domain: shopDomain, since: sinceStr } as any
            }
        });

        await (prisma.connector as any).update({
            where: { id: connectorId },
            data: {
                status: "error",
                last_error: error.message,
                last_error_at: new Date()
            }
        });

        throw error;
    }
}

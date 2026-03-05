import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import crypto from "crypto";

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || "", { maxRetriesPerRequest: null });
const computeQueue = new Queue("jobs", { connection: connection as any });

function encryptToken(plainText: string) {
    const ALGO = 'aes-256-gcm';
    const b64 = process.env.ENCRYPTION_KEY_BASE64;
    if (!b64) throw new Error("Missing ENCRYPTION_KEY_BASE64 in env");
    const key = Buffer.from(b64, 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    let enc = cipher.update(plainText, 'utf8', 'base64');
    enc += cipher.final('base64');
    return { enc, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

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

export async function getValidMeliAccessTokenWorker(connectorId: string): Promise<string> {
    const connector = await (prisma as any).connector.findUnique({
        where: { id: connectorId }
    });

    if (!connector || connector.type !== "mercadolivre") throw new Error("Invalid or unsupported connector");
    const config = connector.config as any;
    if (!config || !config.access_token_enc) throw new Error("Missing Meli configuration");

    const expiresAt = new Date(config.expires_at);
    const nowWithMargin = new Date(Date.now() + 2 * 60 * 1000);

    if (expiresAt > nowWithMargin) {
        return decryptToken(config.access_token_enc, config.access_token_iv, config.access_token_tag);
    }

    if (!config.refresh_token_enc) throw new Error("Missing refresh_token");

    const refreshToken = decryptToken(config.refresh_token_enc, config.refresh_token_iv, config.refresh_token_tag);
    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;

    if (!clientId || !clientSecret) throw new Error("Missing Meli Env Vars");

    const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString()
    });

    if (!tokenRes.ok) throw new Error(`Failed to refresh Meli token`);

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token: new_refresh_token, expires_in } = tokenData;

    const encAccess = encryptToken(access_token);
    const encRefresh = new_refresh_token ? encryptToken(new_refresh_token) : null;
    const newExpiresAt = new Date(Date.now() + expires_in * 1000);

    const newConfig = {
        ...config,
        access_token_enc: encAccess.enc, access_token_iv: encAccess.iv, access_token_tag: encAccess.tag,
        refresh_token_enc: encRefresh?.enc || config.refresh_token_enc,
        refresh_token_iv: encRefresh?.iv || config.refresh_token_iv,
        refresh_token_tag: encRefresh?.tag || config.refresh_token_tag,
        expires_at: newExpiresAt.toISOString()
    };

    await (prisma as any).connector.update({ where: { id: connectorId }, data: { config: newConfig } });
    return access_token;
}

export default async function meliSyncJob(job: Job) {
    const { tenantId, connectorId, importRunId } = job.data as { tenantId: string, connectorId: string, importRunId: string };

    await prisma.importRun.update({
        where: { id: importRunId },
        data: { status: "running" }
    });

    let errorsCount = 0;
    let ordersUpserted = 0;
    let returnsUpserted = 0;
    let paymentsSeen = 0;
    let shipmentsSeen = 0;
    let sinceStr = "";
    const affectedReturnIds: string[] = [];

    const connectorResult = await prisma.connector.findUnique({ where: { id: connectorId } });
    const connector = connectorResult as any;
    if (!connector || connector.type !== "mercadolivre" || connector.status !== "connected") {
        throw new Error("Invalid or disconnected Meli connector.");
    }
    const config = connector.config as any;
    const sellerId = config.user_id;

    try {
        const accessToken = await getValidMeliAccessTokenWorker(connectorId);
        const headers = { Authorization: `Bearer ${accessToken}` };

        // Determine since date (90 days default MVP)
        const since = connector.last_sync_at || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        sinceStr = since.toISOString();
        // Meli requires format: 2015-07-01T00:00:00.000-00:00
        const mliDateStr = since.toISOString().replace("Z", "-00:00");

        let offset = 0;
        let limit = 50;
        let hasMore = true;

        while (hasMore) {
            const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.date_closed.from=${mliDateStr}&offset=${offset}&limit=${limit}`;
            const res = await fetch(url, { headers });

            if (!res.ok) {
                throw new Error(`Meli list orders error: ${await res.text()}`);
            }

            const data = await res.json();
            const orders = data.results || [];
            if (orders.length === 0 || offset >= data.paging.total) {
                hasMore = false;
                break;
            }

            for (const order of orders) {
                try {
                    // Upsert Customer (Buyer)
                    let customerId = null;
                    if (order.buyer && order.buyer.id) {
                        const buyerIdStr = order.buyer.id.toString();
                        const cust = await prisma.customer.upsert({
                            where: { tenant_id_external_id: { tenant_id: tenantId, external_id: buyerIdStr } },
                            create: {
                                tenant_id: tenantId,
                                external_id: buyerIdStr,
                                email: order.buyer.email || null,
                                phone: order.buyer.phone?.number || null,
                                name: `${order.buyer.first_name || ""} ${order.buyer.last_name || ""}`.trim() || order.buyer.nickname || "User"
                            },
                            update: {
                                email: order.buyer.email || undefined,
                                name: `${order.buyer.first_name || ""} ${order.buyer.last_name || ""}`.trim() || order.buyer.nickname || undefined
                            }
                        });
                        customerId = cust.id;
                    }

                    // Upsert Order
                    const totalAmount = order.total_amount || 0;
                    const dbOrderResult = await prisma.order.upsert({
                        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: order.id.toString() } } as any,
                        create: {
                            tenant_id: tenantId,
                            external_id: order.id.toString(),
                            connector_id: connectorId,
                            customer_id: customerId,
                            status: order.status || "processed",
                            total_cents: Math.round(totalAmount * 100),
                            currency: order.currency_id || "BRL",
                            placed_at: new Date(order.date_created),
                            raw_payload: order
                        },
                        update: {
                            status: order.status || "processed",
                            raw_payload: order as any
                        }
                    });
                    const dbOrder = dbOrderResult as any;
                    ordersUpserted++;

                    // Upsert Line items
                    const orderItemMap = new Map<string, string>(); // Item ID -> DB OrderItem ID
                    if (order.order_items && Array.isArray(order.order_items)) {
                        for (const item of order.order_items) {
                            const unitPrice = item.unit_price || 0;
                            const itemId = item.item?.id || `item_${item.id}`;
                            const dbLi = await prisma.orderItem.upsert({
                                where: { id: item.id ? item.id.toString() : "0" } as any, // Not strictly correct but MVP
                                create: {
                                    tenant_id: tenantId,
                                    order_id: dbOrder.id,
                                    external_id: itemId.toString(),
                                    sku: item.item?.seller_sku || itemId.toString(),
                                    product_name: item.item?.title || "Meli Produto",
                                    quantity: item.quantity || 1,
                                    unit_price_cents: Math.round(unitPrice * 100)
                                },
                                update: {}
                            }).catch(async () => {
                                // Fallback create if no unique constraint matched
                                return await prisma.orderItem.create({
                                    data: {
                                        tenant_id: tenantId,
                                        order_id: dbOrder.id,
                                        external_id: itemId.toString(),
                                        sku: item.item?.seller_sku || itemId.toString(),
                                        product_name: item.item?.title || "Meli Produto",
                                        quantity: item.quantity || 1,
                                        unit_price_cents: Math.round(unitPrice * 100)
                                    }
                                });
                            });
                            orderItemMap.set(itemId.toString(), dbLi.id);
                        }
                    }

                    // Fetch Shipments (optional flag, but counts)
                    if (order.shipping && order.shipping.id) {
                        shipmentsSeen++;
                    }

                    // Process Payments & Refunds MVP
                    if (order.payments && Array.isArray(order.payments)) {
                        for (const pay of order.payments) {
                            paymentsSeen++;
                            if (pay.status === "refunded" || pay.status === "cancelled" || pay.status === "charged_back") {
                                // Meli canonical return derivation
                                const externalRefundId = `meli_payment:${pay.id}:refund`;
                                const refundAmmount = pay.transaction_amount || totalAmount;
                                const refundDate = pay.date_last_updated || pay.date_created || order.date_created;

                                const dbReturnResult = await prisma.return.upsert({
                                    where: { tenant_id_external_id: { tenant_id: tenantId, external_id: externalRefundId } } as any,
                                    create: {
                                        tenant_id: tenantId,
                                        external_id: externalRefundId,
                                        order_id: dbOrder.id,
                                        connector_id: connectorId,
                                        status: pay.status === "cancelled" ? "cancelled" : "refunded",
                                        refund_amount_cents: Math.round(refundAmmount * 100),
                                        requested_at: new Date(refundDate),
                                        reason: `ML Payment Status: ${pay.status}`,
                                        raw_payload: pay as any
                                    },
                                    update: {
                                        refund_amount_cents: Math.round(refundAmmount * 100)
                                    }
                                });
                                const dbReturn = dbReturnResult as any;

                                // Best effort mapping items to the return
                                if (order.order_items && Array.isArray(order.order_items)) {
                                    for (const item of order.order_items) {
                                        const itemId = item.item?.id || `item_${item.id}`;
                                        const orderItemId = orderItemMap.get(itemId.toString());
                                        if (orderItemId) {
                                            await prisma.returnItem.create({
                                                data: {
                                                    tenant_id: tenantId,
                                                    return_id: dbReturn.id,
                                                    order_item_id: orderItemId,
                                                    quantity: item.quantity || 1
                                                }
                                            }).catch(() => { }); // ignore duplicates
                                        }
                                    }
                                }

                                returnsUpserted++;
                                if (!affectedReturnIds.includes(dbReturn.id)) {
                                    affectedReturnIds.push(dbReturn.id);
                                }
                            }
                        }
                    }

                    // Claim mappings (future logic) -> could hit /post-purchase/v1/claims/search
                } catch (rowErr: any) {
                    errorsCount++;
                    await prisma.importError.create({
                        data: {
                            tenant_id: tenantId,
                            import_run_id: importRunId,
                            external_id: order.id ? order.id.toString() : "unknown",
                            message: rowErr.message || "Failed to process meli order",
                            payload: { error: rowErr.message, stage: "order_loop" } as any
                        }
                    });
                }
            }

            offset += limit;
        }

        // Finalize
        await (prisma as any).connector.update({
            where: { id: connectorId },
            data: { status: "connected", last_sync_at: new Date() }
        });

        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: "success",
                error_rows: errorsCount,
                success_rows: ordersUpserted + returnsUpserted,
                finished_at: new Date(),
                summary: { orders_upserted: ordersUpserted, returns_upserted: returnsUpserted, payments_seen: paymentsSeen, shipments_seen: shipmentsSeen, errors: errorsCount, since: sinceStr } as any
            }
        });

        for (const retId of affectedReturnIds) {
            await computeQueue.add("compute_features_for_return", { returnId: retId, tenantId });
        }

        return { success: true, processedReturns: affectedReturnIds.length };

    } catch (globalErr: any) {
        console.error("Meli Sync Global Error:", globalErr);

        await prisma.importRun.update({
            where: { id: importRunId },
            data: {
                status: "failed",
                error_rows: errorsCount + 1,
                finished_at: new Date(),
                summary: { error: globalErr.message, since: sinceStr } as any
            }
        });

        await (prisma as any).connector.update({
            where: { id: connectorId },
            data: { status: "error", last_error: globalErr.message, last_error_at: new Date() }
        });

        throw globalErr;
    }
}

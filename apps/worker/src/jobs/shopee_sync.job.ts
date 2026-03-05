import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import crypto from "crypto";

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || "", { maxRetriesPerRequest: null });
const computeQueue = new Queue("jobs", { connection: connection as any });

function decryptToken(enc: string, iv: string, tag: string) {
    if (enc === "using_config") return null; // Fallback or unset
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

// Shopee HMAC-SHA256 signature logic
function generateShopeeSign(partnerKey: string, apiPath: string, partnerId: string, timestamp: number, shopId: string, accessToken?: string | null) {
    // According to Shopee Open API V2:
    // sign = hash_hmac('sha256', partner_id + api_path + timestamp + access_token + shop_id, partner_key)
    // token and shopId are omitted if not present/required for the specific endpoint
    let baseStr = `${partnerId}${apiPath}${timestamp}`;
    if (accessToken) baseStr += accessToken;
    if (shopId) baseStr += shopId;

    return crypto.createHmac('sha256', partnerKey).update(baseStr).digest('hex');
}

export default async function shopeeSyncJob(job: Job) {
    const { tenantId, connectorId, importRunId } = job.data as { tenantId: string, connectorId: string, importRunId: string };

    await prisma.importRun.update({
        where: { id: importRunId },
        data: { status: "running" }
    });

    let errorsCount = 0;
    let ordersUpserted = 0;
    let returnsUpserted = 0;
    let sinceStr = "";
    const affectedReturnIds: string[] = [];

    const connectorResult = await prisma.connector.findUnique({ where: { id: connectorId } });
    const connector = connectorResult as any;
    if (!connector || connector.type !== "shopee" || connector.status !== "connected") {
        throw new Error("Invalid or disconnected Shopee connector");
    }

    const config = connector.config as any;
    const shopId = config.shop_id;
    const apiBase = config.api_base || "https://partner.shopeemobile.com";

    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY; // Base64 or string, fallback

    if (!partnerId || !partnerKey) {
        throw new Error("Missing SHOPEE_PARTNER_ID or SHOPEE_PARTNER_KEY env vars");
    }

    let accessToken = null;
    if (config.access_token_enc && config.access_token_enc !== "using_config") {
        accessToken = decryptToken(config.access_token_enc, config.access_token_iv, config.access_token_tag);
    }

    try {
        const sinceDateStr = connector.last_sync_at || new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
        sinceStr = sinceDateStr.toString();
        const timeFrom = Math.floor(new Date(sinceStr).getTime() / 1000);
        const timeTo = Math.floor(Date.now() / 1000);

        // Fetch Orders List
        let cursor = "";
        let hasMore = true;
        const shopeeOrderRecords: any[] = [];

        while (hasMore) {
            const path = "/api/v2/order/get_order_list";
            const ts = Math.floor(Date.now() / 1000);
            const sign = generateShopeeSign(partnerKey, path, partnerId, ts, shopId.toString(), accessToken);

            let url = `${apiBase}${path}?partner_id=${partnerId}&timestamp=${ts}&shop_id=${shopId}&sign=${sign}&time_range_field=create_time&time_from=${timeFrom}&time_to=${timeTo}&page_size=50`;
            if (accessToken) url += `&access_token=${accessToken}`;
            if (cursor) url += `&cursor=${cursor}`;

            const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
            if (!res.ok) throw new Error(`Shopee get_order_list error: ${await res.text()}`);
            const data = await res.json();

            if (data.error) throw new Error(`Shopee API Error: ${data.error} - ${data.message}`);

            const list = data.response?.order_list || [];
            shopeeOrderRecords.push(...list);

            cursor = data.response?.next_cursor;
            hasMore = data.response?.more && !!cursor;
        }

        // Fetch Order Details in batches (max 50 per call)
        // Shopee requires a secondary call to get the actual details using the SNs
        const fetchedDetails = [];
        for (let i = 0; i < shopeeOrderRecords.length; i += 50) {
            const batch = shopeeOrderRecords.slice(i, i + 50);
            const orderSnList = batch.map(o => o.order_sn).join(",");

            const path = "/api/v2/order/get_order_detail";
            const ts = Math.floor(Date.now() / 1000);
            const sign = generateShopeeSign(partnerKey, path, partnerId, ts, shopId.toString(), accessToken);

            let url = `${apiBase}${path}?partner_id=${partnerId}&timestamp=${ts}&shop_id=${shopId}&sign=${sign}&order_sn_list=${orderSnList}`;
            if (accessToken) url += `&access_token=${accessToken}`;

            const res = await fetch(url);
            const data = await res.json();
            if (data.error) {
                console.error("Failed batch fetching Shopee Order Details:", data.message);
                continue;
            }
            if (data.response?.order_list) {
                fetchedDetails.push(...data.response.order_list);
            }
        }

        // Process Orders and Canonical Mapping
        for (const order of fetchedDetails) {
            try {
                // Canonical Customer (Buyer)
                let customerId = null;
                const buyerName = order.buyer_username || "Comprador Shopee";
                const dbCust = await prisma.customer.upsert({
                    where: { tenant_id_external_id: { tenant_id: tenantId, external_id: buyerName } },
                    create: {
                        tenant_id: tenantId,
                        external_id: buyerName,
                        name: buyerName
                    },
                    update: {} // No update needed for buyerName if it's the id
                });
                customerId = dbCust.id;

                // Canonical Order
                const totalAmount = order.total_amount || 0;
                const createdTime = order.create_time ? new Date(order.create_time * 1000) : new Date();

                const dbOrderResult = await prisma.order.upsert({
                    where: { tenant_id_external_id: { tenant_id: tenantId, external_id: order.order_sn } } as any,
                    create: {
                        tenant_id: tenantId,
                        external_id: order.order_sn,
                        connector_id: connectorId,
                        customer_id: customerId,
                        status: order.order_status || "UNPAID",
                        total_cents: Math.round(totalAmount * 100),
                        currency: order.currency || "BRL",
                        placed_at: createdTime,
                        raw_payload: order as any
                    },
                    update: {
                        status: order.order_status,
                        raw_payload: order as any
                    }
                });
                const dbOrder = dbOrderResult as any;
                ordersUpserted++;

                const orderItemMap = new Map<string, string>();
                if (order.item_list && Array.isArray(order.item_list)) {
                    for (const item of order.item_list) {
                        const unitPrice = item.model_discounted_price || item.model_original_price || 0;
                        const itemId = `${item.item_id}_${item.model_id}`; // Unique identity

                        const dbLi = await prisma.orderItem.upsert({
                            where: { id: "0" } as any, // Not safe for concurrent scale, MVP fallback
                            create: {
                                tenant_id: tenantId,
                                order_id: dbOrder.id,
                                external_id: itemId,
                                sku: item.item_sku || itemId,
                                product_name: item.item_name || "Shopee Item",
                                quantity: item.model_quantity_purchased || 1,
                                unit_price_cents: Math.round(unitPrice * 100)
                            },
                            update: {}
                        }).catch(async () => {
                            return await prisma.orderItem.create({
                                data: {
                                    tenant_id: tenantId,
                                    order_id: dbOrder.id,
                                    external_id: itemId,
                                    sku: item.item_sku || itemId,
                                    product_name: item.item_name || "Shopee Item",
                                    quantity: item.model_quantity_purchased || 1,
                                    unit_price_cents: Math.round(unitPrice * 100)
                                }
                            });
                        });
                        orderItemMap.set(itemId, dbLi.id);
                    }
                }

                // Canonical Returns (Derivative Signals from Order Status)
                // Shopee returns specific API requires v2.1/returns which often requires separate whitelist.
                // We use the reliable order_status signals: "CANCELLED", "RETURN_REFUND" (often implicitly shown if we had it), or 'INVALIDS'
                if (order.order_status === "CANCELLED" || order.cancel_reason) {
                    // It's a cancellation or early refund
                    const externalRefundId = `shopee_signal:${order.order_sn}:cancel`;
                    const updateTime = order.update_time ? new Date(order.update_time * 1000) : new Date();

                    const dbReturnResult = await prisma.return.upsert({
                        where: { tenant_id_external_id: { tenant_id: tenantId, external_id: externalRefundId } } as any,
                        create: {
                            tenant_id: tenantId,
                            external_id: externalRefundId,
                            order_id: dbOrder.id,
                            connector_id: connectorId,
                            status: "cancelled", // Canonical representation of early fraud refund
                            refund_amount_cents: Math.round(totalAmount * 100),
                            requested_at: updateTime,
                            reason: `Shopee Cancel Reason: ${order.cancel_reason || 'Unknown'}`,
                            raw_payload: order as any
                        },
                        update: {
                            refund_amount_cents: Math.round(totalAmount * 100),
                            reason: `Shopee Cancel Reason: ${order.cancel_reason || 'Unknown'}`
                        }
                    });
                    const dbReturn = dbReturnResult as any;

                    // map items
                    for (const [_, oItemId] of orderItemMap.entries()) {
                        await prisma.returnItem.create({
                            data: {
                                tenant_id: tenantId,
                                return_id: dbReturn.id,
                                order_item_id: oItemId,
                                quantity: 1 // fallback
                            }
                        }).catch(() => { });
                    }

                    returnsUpserted++;
                    if (!affectedReturnIds.includes(dbReturn.id)) affectedReturnIds.push(dbReturn.id);
                }

            } catch (err: any) {
                errorsCount++;
                await prisma.importError.create({
                    data: {
                        tenant_id: tenantId,
                        import_run_id: importRunId,
                        external_id: order.order_sn || "unknown",
                        message: err.message || "Failed to process shopee order",
                        payload: { error: err.message, stage: "order_loop" } as any
                    }
                });
            }
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
                summary: { orders_upserted: ordersUpserted, returns_upserted: returnsUpserted, errors: errorsCount, since: sinceStr } as any
            }
        });

        for (const retId of affectedReturnIds) {
            await computeQueue.add("compute_features_for_return", { returnId: retId, tenantId });
        }

        return { success: true, processedReturns: affectedReturnIds.length };

    } catch (globalErr: any) {
        console.error("Shopee Sync Global Error:", globalErr);

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

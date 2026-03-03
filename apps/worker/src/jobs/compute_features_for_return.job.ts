import { Job, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "", { maxRetriesPerRequest: null });
const testQueue = new Queue("jobs", { connection } as any);

const prisma = new PrismaClient();

export default async function computeFeaturesForReturnJob(job: Job) {
    const { tenantId, returnId } = job.data;

    if (!tenantId || !returnId) {
        throw new Error("Missing tenantId or returnId payload");
    }

    console.log(`[Worker] Started compute_features_for_return for Return ${returnId} (Tenant ${tenantId})`);

    // 1. Fetch Return with related Order and Customer
    const returnInfo = await prisma.return.findFirst({
        where: { id: returnId, tenant_id: tenantId },
        include: {
            order: {
                include: {
                    customer: true,
                    items: true,
                }
            },
            items: true,
        }
    });

    if (!returnInfo) {
        throw new Error(`Return ${returnId} not found or tenant mismatch.`);
    }

    const { order, items: returnItems } = returnInfo;

    // 2. Initialize Features Payload
    const features: Record<string, any> = {
        days_to_return: null,
        days_since_order: null,
        customer_returns_30d: 0,
        customer_orders_30d: 0,
        order_total_cents: order?.total_cents || 0,
        return_refund_amount_cents: returnInfo.refund_amount_cents || 0,
        refund_ratio: 0,
        return_items_count: returnItems.length,
        returned_quantity_total: 0,
        returned_items_value_cents: 0,
        missing_customer: false,
        missing_order_placed_at: false,
        missing_requested_at: false,
        missing_item_prices: false,
    };

    // Calculate Refund Ratio
    const safeOrderTotal = Math.max(features.order_total_cents, 1);
    features.refund_ratio = features.return_refund_amount_cents / safeOrderTotal;

    // Calculate Timed Features
    const now = new Date();
    const placedAt = order?.placed_at || order?.created_at;
    const requestedAt = returnInfo.requested_at || returnInfo.created_at;

    if (!placedAt) {
        features.missing_order_placed_at = true;
    } else {
        features.days_since_order = Math.floor((now.getTime() - placedAt.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (!requestedAt) {
        features.missing_requested_at = true;
    }

    if (placedAt && requestedAt) {
        features.days_to_return = Math.floor((requestedAt.getTime() - placedAt.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Historical features if Customer exists
    if (!order?.customer_id) {
        features.missing_customer = true;
    } else {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const recentOrders = await prisma.order.count({
            where: {
                tenant_id: tenantId,
                customer_id: order.customer_id,
                created_at: { gte: thirtyDaysAgo }
            }
        });

        const recentReturns = await prisma.return.count({
            where: {
                tenant_id: tenantId,
                order: { customer_id: order.customer_id },
                created_at: { gte: thirtyDaysAgo }
            }
        });

        features.customer_orders_30d = recentOrders;
        features.customer_returns_30d = recentReturns;
    }

    // Items value calculations
    let totalValueCents = 0;
    let totalQty = 0;

    for (const retItem of returnItems) {
        totalQty += (retItem.quantity || 1);

        if (retItem.order_item_id) {
            const linkedOrderItem = order.items.find((i: any) => i.id === retItem.order_item_id);
            if (linkedOrderItem && linkedOrderItem.unit_price_cents !== null) {
                totalValueCents += (linkedOrderItem.unit_price_cents * (retItem.quantity || 1));
            } else {
                features.missing_item_prices = true;
            }
        } else {
            features.missing_item_prices = true;
        }
    }

    features.returned_quantity_total = totalQty;
    // Set returned value (if we were missing prices, value is incomplete, but we still sum what we have or 0)
    features.returned_items_value_cents = features.missing_item_prices && totalValueCents === 0 ? 0 : totalValueCents;

    // 3. Save to database snapshot
    await prisma.featuresSnapshot.create({
        data: {
            tenant_id: tenantId,
            return_id: returnId,
            schema_version: "v1",
            features_json: features,
            computed_at: new Date(),
        } as any
    });

    // 4. Enqueue Risk Score Automation
    await testQueue.add("compute_risk_score_for_return", { tenantId, returnId });
    console.log(`[Worker] Triggered risk score computation for returnId ${returnId}`);

    return { success: true, features };
}

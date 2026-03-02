import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Starting canonical database seed...");

    // 1. Create 2 Users
    const passwordHash = await bcrypt.hash("password123", 10);
    const userA = await prisma.user.upsert({
        where: { email: "ownerA@seed.com" },
        update: {},
        create: {
            email: "ownerA@seed.com",
            password_hash: passwordHash,
        },
    });

    const userB = await prisma.user.upsert({
        where: { email: "ownerB@seed.com" },
        update: {},
        create: {
            email: "ownerB@seed.com",
            password_hash: passwordHash,
        },
    });

    // 2. Create 2 Tenants
    const tenantA = await prisma.tenant.upsert({
        where: { slug: "tenant-a-seed" },
        update: {},
        create: {
            name: "Tenant A Seed",
            slug: "tenant-a-seed",
        },
    });

    const tenantB = await prisma.tenant.upsert({
        where: { slug: "tenant-b-seed" },
        update: {},
        create: {
            name: "Tenant B Seed",
            slug: "tenant-b-seed",
        },
    });

    // 3. Link Users to Tenants (owner role)
    const mem1 = await prisma.membership.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantA.id, user_id: userA.id } }
    });
    if (!mem1) {
        await prisma.membership.create({
            data: { tenant_id: tenantA.id, user_id: userA.id, role: "owner" }
        });
    }

    const mem2 = await prisma.membership.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantB.id, user_id: userB.id } }
    });
    if (!mem2) {
        await prisma.membership.create({
            data: { tenant_id: tenantB.id, user_id: userB.id, role: "owner" }
        });
    }

    // 4. Seed Data For Tenant A
    console.log(`Populating Tenant A (${tenantA.id})...`);

    // Customer
    const customerA = await prisma.customer.upsert({
        where: { tenant_id_external_id: { tenant_id: tenantA.id, external_id: "ext-cust-A1" } },
        update: {},
        create: {
            tenant_id: tenantA.id,
            external_id: "ext-cust-A1",
            email: "client@tenanta.com",
            name: "Test Customer A",
        }
    });

    // Order with 2 Items
    const orderA = await prisma.order.upsert({
        where: {
            // workaround since unique constraint is not on id but we have external_id unique index
            id: "00000000-0000-0000-0000-0000000000A1" // We dont enforce unique on id in upsert where there's no unique. So we look for first.
        },
        update: {},
        create: {
            id: "00000000-0000-0000-0000-0000000000A1",
            tenant_id: tenantA.id,
            external_id: "ext-order-A1",
            customer_id: customerA.id,
            status: "delivered",
            total_cents: 5000,
            placed_at: new Date(),
            items: {
                create: [
                    { tenant_id: tenantA.id, sku: "SKU-A-1", product_name: "Macbook", quantity: 1, unit_price_cents: 4000 },
                    { tenant_id: tenantA.id, sku: "SKU-A-2", product_name: "Mouse", quantity: 1, unit_price_cents: 1000 }
                ]
            }
        }
    }).catch(async (e) => {
        // If it exists, just find it
        return await prisma.order.findFirst({ where: { tenant_id: tenantA.id, external_id: "ext-order-A1" } });
    });

    if (orderA) {
        // Return 
        const returnA = await prisma.return.findFirst({ where: { tenant_id: tenantA.id, external_id: "ext-return-A1" } });
        let createdReturn;
        if (!returnA) {
            createdReturn = await prisma.return.create({
                data: {
                    tenant_id: tenantA.id,
                    external_id: "ext-return-A1",
                    order_id: orderA.id,
                    status: "requested",
                    reason: "Not what I expected",
                    refund_amount_cents: 5000,
                    requested_at: new Date(),
                }
            });

            // Return item
            const firstOrderItem = await prisma.orderItem.findFirst({ where: { order_id: orderA.id } });
            if (firstOrderItem) {
                await prisma.returnItem.create({
                    data: {
                        tenant_id: tenantA.id,
                        return_id: createdReturn.id,
                        order_item_id: firstOrderItem.id,
                        sku: firstOrderItem.sku,
                        product_name: firstOrderItem.product_name,
                        quantity: 1,
                        condition: "new"
                    }
                });
            }

            // Fake Fraud Score
            await prisma.fraudScore.create({
                data: {
                    tenant_id: tenantA.id,
                    return_id: createdReturn.id,
                    model_version: "v1-alpha",
                    score: 0.1250,
                    risk_level: "low",
                    explanation: { "distance": "far", "ip_match": true }
                }
            });

            // Fake Features Snapshot
            await prisma.featuresSnapshot.create({
                data: {
                    tenant_id: tenantA.id,
                    return_id: createdReturn.id,
                    features: { "account_age_days": 10, "is_new_device": false }
                }
            });

            // Fake Decision
            await prisma.decision.create({
                data: {
                    tenant_id: tenantA.id,
                    return_id: createdReturn.id,
                    decision: "approve",
                    reason: "Low risk auto-approval"
                }
            });
        }
    }

    // 5. Seed Data For Tenant B
    console.log(`Populating Tenant B (${tenantB.id})...`);

    // Order
    let orderB = await prisma.order.findFirst({ where: { tenant_id: tenantB.id, external_id: "ext-order-B1" } });
    if (!orderB) {
        orderB = await prisma.order.create({
            data: {
                tenant_id: tenantB.id,
                external_id: "ext-order-B1",
                status: "shipped",
                total_cents: 8000,
                placed_at: new Date(),
                items: {
                    create: [
                        { tenant_id: tenantB.id, sku: "SKU-B-1", product_name: "Monitor", quantity: 1, unit_price_cents: 8000 },
                    ]
                }
            }
        });
    }

    // Return
    let returnB = await prisma.return.findFirst({ where: { tenant_id: tenantB.id, external_id: "ext-return-B1" } });
    if (!returnB && orderB) {
        await prisma.return.create({
            data: {
                tenant_id: tenantB.id,
                external_id: "ext-return-B1",
                order_id: orderB.id,
                status: "requested",
                refund_amount_cents: 8000,
            }
        });
    }

    console.log("✅ Seed completed successfully!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

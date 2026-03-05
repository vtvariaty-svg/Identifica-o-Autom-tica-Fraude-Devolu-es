import { prisma } from "../db";
import { encryptToken, decryptToken } from "./crypto";

export async function getValidMeliAccessToken(connectorId: string): Promise<string> {
    const connector = await (prisma as any).connector.findUnique({
        where: { id: connectorId }
    });

    if (!connector || connector.type !== "mercadolivre") {
        throw new Error("Invalid or unsupported connector for Meli Token Refresh");
    }

    const config = connector.config as any;
    if (!config || !config.access_token_enc) {
        throw new Error("Meli connector missing token configuration");
    }

    const expiresAt = new Date(config.expires_at);
    // Add 2 minutes margin
    const nowWithMargin = new Date(Date.now() + 2 * 60 * 1000);

    if (expiresAt > nowWithMargin) {
        // Token is still valid, decrypt and return
        return decryptToken({
            enc: config.access_token_enc,
            iv: config.access_token_iv,
            tag: config.access_token_tag
        });
    }

    // Token is expired, need to refresh
    if (!config.refresh_token_enc) {
        throw new Error("Meli connector missing refresh_token for renewal");
    }

    const refreshToken = decryptToken({
        enc: config.refresh_token_enc,
        iv: config.refresh_token_iv,
        tag: config.refresh_token_tag
    });
    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing Meli Env Vars for Refresh");
    }

    const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json"
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken
        }).toString()
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Failed to refresh Meli token: ${err}`);
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token: new_refresh_token, expires_in } = tokenData;

    const encAccess = encryptToken(access_token);
    const encRefresh = new_refresh_token ? encryptToken(new_refresh_token) : null;
    const newExpiresAt = new Date(Date.now() + expires_in * 1000);

    const newConfig = {
        ...config,
        access_token_enc: encAccess.enc,
        access_token_iv: encAccess.iv,
        access_token_tag: encAccess.tag,
        refresh_token_enc: encRefresh?.enc || config.refresh_token_enc,
        refresh_token_iv: encRefresh?.iv || config.refresh_token_iv,
        refresh_token_tag: encRefresh?.tag || config.refresh_token_tag,
        expires_at: newExpiresAt.toISOString()
    };

    await (prisma as any).connector.update({
        where: { id: connectorId },
        data: { config: newConfig }
    });

    return access_token;
}

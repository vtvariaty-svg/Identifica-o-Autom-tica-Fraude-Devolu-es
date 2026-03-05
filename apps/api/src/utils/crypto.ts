import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

// Lazy-load to avoid crashing the whole app if env is not set yet, 
// but will crash when encrypt/decrypt is actually called.
function getKey() {
    const b64 = process.env.ENCRYPTION_KEY_BASE64;
    if (!b64) throw new Error("Missing ENCRYPTION_KEY_BASE64 in env");
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY_BASE64 must be 32 bytes decoded");
    return key;
}

export function encryptToken(plain: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);

    let enc = cipher.update(plain, 'utf8', 'base64');
    enc += cipher.final('base64');

    return {
        enc,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
    };
}

export function decryptToken(opts: { enc: string, iv: string, tag: string }) {
    const decipher = crypto.createDecipheriv(
        ALGO,
        getKey(),
        Buffer.from(opts.iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(opts.tag, 'base64'));

    let plain = decipher.update(opts.enc, 'base64', 'utf8');
    plain += decipher.final('utf8');

    return plain;
}

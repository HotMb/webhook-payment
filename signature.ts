import crypto from "crypto";

export function computeWebhookSignature(payload: Buffer | string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyWebhookSignature(
    signature: string,
    payload: Buffer | string,
    secret: string
): boolean {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;

    const received = Buffer.from(signature, "hex");
    const expected = Buffer.from(computeWebhookSignature(payload, secret), "hex");

    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

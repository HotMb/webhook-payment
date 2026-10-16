import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWebhookSignature, verifyWebhookSignature } from "../signature";

const secret = "test-secret-only";
const payload = Buffer.from('{"id":"evt_test","type":"PAYMENT"}');
const signature = computeWebhookSignature(payload, secret);

describe("webhook signature verification", () => {
    it("accepts a valid HMAC", () => {
        assert.equal(verifyWebhookSignature(signature, payload, secret), true);
    });

    it("rejects a different secret or payload", () => {
        assert.equal(verifyWebhookSignature(signature, payload, "other-secret"), false);
        assert.equal(verifyWebhookSignature(signature, Buffer.from("{}"), secret), false);
    });

    it("rejects malformed and wrong-length signatures without throwing", () => {
        assert.equal(verifyWebhookSignature("bad-signature", payload, secret), false);
        assert.equal(verifyWebhookSignature("00", payload, secret), false);
    });
});

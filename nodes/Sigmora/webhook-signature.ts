import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_FRESHNESS_MS = 5 * 60 * 1000;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
	return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifyWebhookSignature(
	secret: string,
	timestamp: string | undefined,
	rawBody: string,
	supplied: string | undefined,
	nowMs = Date.now(),
): boolean {
	if (!timestamp || !supplied) return false;
	const deliveryTime = Date.parse(timestamp);
	if (!Number.isFinite(deliveryTime) || Math.abs(nowMs - deliveryTime) > WEBHOOK_FRESHNESS_MS) {
		return false;
	}
	const expectedBytes = Buffer.from(signWebhook(secret, timestamp, rawBody));
	const suppliedBytes = Buffer.from(supplied);
	return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function authenticate(presentedKey: string | null | undefined): void {
  const presented = presentedKey ?? '';
  const expected = config.BRIDGE_API_KEY ?? '';

  const ok = timingSafeEqual(digest(presented), digest(expected));
  if (!ok || expected.length === 0) {
    throw new HttpError(401, 'AUTHENTICATION_FAILED', 'Valid bridge credentials are required.');
  }
}

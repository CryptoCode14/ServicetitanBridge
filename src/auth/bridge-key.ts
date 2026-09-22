import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface KeyRecord {
  keyId: string;
  name: string;
  digest: string;
  enabled: boolean;
  expiresAt: string | null;
}

let keyStore: KeyRecord[] | null = null;

function loadKeyStore(): KeyRecord[] {
  if (keyStore) return keyStore;
  try {
    const raw = JSON.parse(config.BRIDGE_KEY_STORE);
    if (Array.isArray(raw)) {
      keyStore = raw as KeyRecord[];
    } else {
      keyStore = [raw as KeyRecord];
    }
  } catch (err) {
    console.error("Failed to parse BRIDGE_KEY_STORE", err);
    keyStore = [];
  }
  return keyStore;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function authenticate(presentedKey: string | null | undefined): KeyRecord {
  const presented = presentedKey ?? '';
  if (!presented) {
    throw new HttpError(401, 'AUTHENTICATION_FAILED', 'Valid bridge credentials are required.');
  }

  const store = loadKeyStore();
  const presentedDigestBuf = digest(presented);

  let matchedRecord: KeyRecord | null = null;

  for (const record of store) {
    if (!record.enabled) continue;
    
    let rawExpectedDigest = record.digest;
    if (rawExpectedDigest.startsWith('sha256:')) {
      rawExpectedDigest = rawExpectedDigest.split(':')[1];
    }
    
    const expectedBuf = Buffer.from(rawExpectedDigest, 'hex');
    
    if (expectedBuf.length === presentedDigestBuf.length) {
      if (timingSafeEqual(presentedDigestBuf, expectedBuf)) {
        matchedRecord = record;
      }
    }
  }

  if (!matchedRecord) {
    throw new HttpError(401, 'AUTHENTICATION_FAILED', 'Valid bridge credentials are required.');
  }

  if (matchedRecord.expiresAt && new Date(matchedRecord.expiresAt) < new Date()) {
     throw new HttpError(401, 'AUTHENTICATION_FAILED', 'Valid bridge credentials are required.');
  }

  return matchedRecord;
}

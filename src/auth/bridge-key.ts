import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';
import { loadMergedKeyStore } from './key-store.js';

export { HttpError } from './errors.js';

export type KeyScope = 'full' | 'restricted';

export interface KeyRecord {
  keyId: string;
  name: string;
  digest: string;
  enabled: boolean;
  expiresAt: string | null;
  /**
   * Access scope for this key.
   * - 'full': unrestricted — proxy any method/namespace; explicit mutations subject to WRITE_MODE.
   * - 'restricted': read-only — proxy GET/HEAD only, namespace must be in ALLOWED_READ_NAMESPACES, no explicit mutations.
   * A missing scope is treated as 'full' so keys minted before scopes existed keep their current access (grandfathered).
   * New keys should default to 'restricted' and be promoted to 'full' only deliberately.
   */
  scope?: KeyScope;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Resolve a key's effective scope. Records without a `scope` field
 * (minted before per-key scopes existed) are grandfathered to 'full',
 * so existing integrations keep working with zero config changes.
 */
export function resolveScope(record: KeyRecord): KeyScope {
  return record.scope === 'restricted' ? 'restricted' : 'full';
}

/**
 * Authenticate a presented raw key against the merged key store
 * (env BRIDGE_KEY_STORE union the writable KV store; see key-store.ts).
 * Existing env keys keep working whether or not KV is connected.
 */
export async function authenticate(presentedKey: string | null | undefined): Promise<KeyRecord> {
  const presented = presentedKey ?? '';
  if (!presented) {
    throw new HttpError(401, 'AUTHENTICATION_FAILED', 'Valid bridge credentials are required.');
  }

  const store = await loadMergedKeyStore();
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

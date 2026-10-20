import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import type { KeyRecord, KeyScope } from './bridge-key.js';

/**
 * Key store = UNION of two sources:
 *
 * 1. The `BRIDGE_KEY_STORE` env var (original store; JSON array of KeyRecord).
 *    Read from process config, never written by the app.
 * 2. A runtime-writable store in Vercel KV (Upstash Redis REST API), holding a
 *    single JSON array under one key. Keys created/revoked from the /keys admin
 *    page live here.
 *
 * Merge rule: KV records win on `keyId` conflict. That is what lets the admin
 * page revoke a key that still exists in the env store — the page writes a
 * KV "shadow" copy of the record with `enabled: false`, and the shadow wins.
 *
 * Safety: if KV is not configured (KV_REST_API_URL / KV_REST_API_TOKEN absent)
 * or unreachable, authentication falls back to the env store alone, so existing
 * keys can never be locked out by a KV problem. KV reads are cached for 30s
 * per warm instance, so a create/revoke takes effect everywhere within ~60s;
 * writes refresh the local cache immediately.
 */

const KV_STORE_KEY = 'bridge:key-store:v1';
const CACHE_TTL_MS = 30_000;

export function kvConfigured(): boolean {
  return Boolean(config.KV_REST_API_URL && config.KV_REST_API_TOKEN);
}

// ---------------------------------------------------------------------------
// Env store
// ---------------------------------------------------------------------------

let envKeyStore: KeyRecord[] | null = null;

export function loadEnvKeyStore(): KeyRecord[] {
  if (envKeyStore) return envKeyStore;
  try {
    const raw = JSON.parse(config.BRIDGE_KEY_STORE);
    if (Array.isArray(raw)) {
      envKeyStore = raw as KeyRecord[];
    } else {
      envKeyStore = [raw as KeyRecord];
    }
  } catch (err) {
    console.error('Failed to parse BRIDGE_KEY_STORE', err);
    envKeyStore = [];
  }
  return envKeyStore;
}

// ---------------------------------------------------------------------------
// KV store (Upstash REST)
// ---------------------------------------------------------------------------

let kvCache: { records: KeyRecord[]; fetchedAt: number } | null = null;

async function kvCommand(command: string[]): Promise<unknown> {
  const resp = await fetch(config.KV_REST_API_URL as string, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.KV_REST_API_TOKEN as string}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!resp.ok) {
    throw new Error(`KV request failed with status ${resp.status}`);
  }
  const data = (await resp.json()) as { result?: unknown; error?: string };
  if (data.error) {
    throw new Error(`KV error: ${data.error}`);
  }
  return data.result ?? null;
}

async function loadKvKeyStore(forceRefresh = false): Promise<KeyRecord[]> {
  if (!kvConfigured()) return [];
  const now = Date.now();
  if (!forceRefresh && kvCache && now - kvCache.fetchedAt < CACHE_TTL_MS) {
    return kvCache.records;
  }
  try {
    const raw = await kvCommand(['GET', KV_STORE_KEY]);
    let records: KeyRecord[] = [];
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) records = parsed as KeyRecord[];
    }
    kvCache = { records, fetchedAt: now };
    return records;
  } catch (err) {
    // Never break authentication because KV hiccuped: serve the last known
    // KV records if we have them, otherwise env-only.
    console.error('Failed to load KV key store; serving cached/env-only keys:', err);
    return kvCache?.records ?? [];
  }
}

async function saveKvKeyStore(records: KeyRecord[]): Promise<void> {
  if (!kvConfigured()) {
    throw new HttpError(
      503,
      'KEY_STORE_NOT_CONFIGURED',
      'The writable key store is not connected yet. In Vercel: open the servicetitanbridge project, Storage tab, create a KV (Upstash) database and connect it to this project, then redeploy.'
    );
  }
  await kvCommand(['SET', KV_STORE_KEY, JSON.stringify(records)]);
  kvCache = { records, fetchedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Merged view
// ---------------------------------------------------------------------------

export async function loadMergedKeyStore(): Promise<KeyRecord[]> {
  const envRecords = loadEnvKeyStore();
  const kvRecords = await loadKvKeyStore();
  if (kvRecords.length === 0) return envRecords;
  const byId = new Map<string, KeyRecord>();
  for (const record of envRecords) byId.set(record.keyId, record);
  for (const record of kvRecords) byId.set(record.keyId, record); // KV wins
  return [...byId.values()];
}

export interface KeyMetadata {
  keyId: string;
  name: string;
  scope: KeyScope;
  enabled: boolean;
  expiresAt: string | null;
  /** 'page' = created/managed in the writable KV store; 'env' = from BRIDGE_KEY_STORE. */
  source: 'page' | 'env';
}

function effectiveScope(record: KeyRecord): KeyScope {
  return record.scope === 'restricted' ? 'restricted' : 'full';
}

export async function listKeyMetadata(): Promise<KeyMetadata[]> {
  const kvRecords = await loadKvKeyStore();
  const kvIds = new Set(kvRecords.map((r) => r.keyId));
  const merged = await loadMergedKeyStore();
  return merged.map((record) => ({
    keyId: record.keyId,
    name: record.name,
    scope: effectiveScope(record),
    enabled: record.enabled,
    expiresAt: record.expiresAt,
    source: kvIds.has(record.keyId) ? ('page' as const) : ('env' as const),
  }));
}

// ---------------------------------------------------------------------------
// Mutations (admin page)
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Create a key. Only the sha256 digest is stored; the raw key is returned
 * exactly once (here) and can never be retrieved again.
 */
export async function createBridgeKey(
  name: string,
  scope: KeyScope
): Promise<{ record: KeyRecord; rawKey: string }> {
  if (!kvConfigured()) {
    throw new HttpError(
      503,
      'KEY_STORE_NOT_CONFIGURED',
      'The writable key store is not connected yet. In Vercel: open the servicetitanbridge project, Storage tab, create a KV (Upstash) database and connect it to this project, then redeploy.'
    );
  }
  const rawKey = 'stb_live_' + randomBytes(32).toString('base64url');
  const record: KeyRecord = {
    keyId: 'key_' + randomBytes(8).toString('hex'),
    name,
    digest: 'sha256:' + sha256Hex(rawKey),
    enabled: true,
    expiresAt: null,
    scope,
  };
  const kvRecords = await loadKvKeyStore(true);
  await saveKvKeyStore([...kvRecords, record]);
  return { record, rawKey };
}

/**
 * Revoke a key (enabled=false). Works for KV-native keys and for env-store
 * keys (writes a disabled shadow copy into KV, which wins the merge).
 */
export async function revokeBridgeKey(keyId: string): Promise<KeyMetadata> {
  if (!kvConfigured()) {
    throw new HttpError(
      503,
      'KEY_STORE_NOT_CONFIGURED',
      'The writable key store is not connected yet. In Vercel: open the servicetitanbridge project, Storage tab, create a KV (Upstash) database and connect it to this project, then redeploy.'
    );
  }
  const merged = await loadMergedKeyStore();
  const target = merged.find((r) => r.keyId === keyId);
  if (!target) {
    throw new HttpError(404, 'KEY_NOT_FOUND', `No key with id '${keyId}'.`);
  }
  const kvRecords = await loadKvKeyStore(true);
  const disabled: KeyRecord = { ...target, enabled: false };
  const next = kvRecords.some((r) => r.keyId === keyId)
    ? kvRecords.map((r) => (r.keyId === keyId ? disabled : r))
    : [...kvRecords, disabled];
  await saveKvKeyStore(next);
  return {
    keyId: disabled.keyId,
    name: disabled.name,
    scope: effectiveScope(disabled),
    enabled: false,
    expiresAt: disabled.expiresAt,
    source: 'page',
  };
}

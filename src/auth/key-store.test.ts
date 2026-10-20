import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Obviously fake keys — test fixtures only, never real credentials.
const FAKE_ENV_RAW = 'stb_live_FAKE_ENV_KEY_FOR_TESTS_ONLY_000';
const FAKE_ENV_DIGEST =
  'sha256:' + createHash('sha256').update(FAKE_ENV_RAW, 'utf8').digest('hex');

const BASE_ENV: Record<string, string> = {
  ST_ENVIRONMENT: 'integration',
  ST_CLIENT_ID: 'fake-client-id',
  ST_CLIENT_SECRET: 'fake-client-secret',
  ST_APP_KEY: 'fake-app-key',
  ST_TENANT_ID: '123456789',
  BRIDGE_KEY_STORE: JSON.stringify([
    {
      keyId: 'env-key-1',
      name: 'Env Key One',
      digest: FAKE_ENV_DIGEST,
      enabled: true,
      expiresAt: null,
      // no scope on purpose: grandfathered to 'full'
    },
  ]),
};

let kvData: Map<string, string>;

function stubKvFetch() {
  kvData = new Map();
  const fetchStub = vi.fn(async (_url: unknown, init: { body: string }) => {
    const command = JSON.parse(init.body) as string[];
    const [op, key, value] = command;
    if (op === 'GET') {
      return { ok: true, json: async () => ({ result: kvData.get(key) ?? null }) };
    }
    if (op === 'SET') {
      kvData.set(key, value);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    }
    throw new Error('unexpected KV command ' + op);
  });
  vi.stubGlobal('fetch', fetchStub);
}

async function loadModules(withKv: boolean) {
  vi.resetModules();
  for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] = v;
  if (withKv) {
    process.env.KV_REST_API_URL = 'https://fake-kv.example.test';
    process.env.KV_REST_API_TOKEN = 'fake-kv-token';
    stubKvFetch();
  } else {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
  const bridgeKey = await import('./bridge-key.js');
  const keyStore = await import('./key-store.js');
  return { bridgeKey, keyStore };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe('without KV connected (original behavior)', () => {
  it('authenticates the env key and grandfathers it to full scope', async () => {
    const { bridgeKey } = await loadModules(false);
    const record = await bridgeKey.authenticate(FAKE_ENV_RAW);
    expect(record.keyId).toBe('env-key-1');
    expect(bridgeKey.resolveScope(record)).toBe('full');
  });

  it('rejects an unknown key with 401', async () => {
    const { bridgeKey } = await loadModules(false);
    await expect(bridgeKey.authenticate('stb_live_NOT_A_REAL_KEY')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('lists env key metadata without any digest', async () => {
    const { keyStore } = await loadModules(false);
    const meta = await keyStore.listKeyMetadata();
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ keyId: 'env-key-1', scope: 'full', source: 'env' });
    expect(JSON.stringify(meta)).not.toContain('sha256');
  });

  it('refuses to create a key with a clear 503', async () => {
    const { keyStore } = await loadModules(false);
    await expect(keyStore.createBridgeKey('Nope', 'restricted')).rejects.toMatchObject({
      statusCode: 503,
      code: 'KEY_STORE_NOT_CONFIGURED',
    });
  });
});

describe('with KV connected', () => {
  it('env key keeps working alongside the KV store (union)', async () => {
    const { bridgeKey } = await loadModules(true);
    const record = await bridgeKey.authenticate(FAKE_ENV_RAW);
    expect(record.keyId).toBe('env-key-1');
  });

  it('creates a key: raw key returned once, only a digest is stored', async () => {
    const { bridgeKey, keyStore } = await loadModules(true);
    const { record, rawKey } = await keyStore.createBridgeKey('Second Agent', 'restricted');
    expect(rawKey.startsWith('stb_live_')).toBe(true);
    expect(record.digest.startsWith('sha256:')).toBe(true);

    const storedJson = [...kvData.values()].join('\n');
    expect(storedJson).toContain(record.digest);
    expect(storedJson).not.toContain(rawKey);

    const authed = await bridgeKey.authenticate(rawKey);
    expect(authed.keyId).toBe(record.keyId);
    expect(bridgeKey.resolveScope(authed)).toBe('restricted');
  });

  it('revoking a KV-created key blocks it with 401', async () => {
    const { bridgeKey, keyStore } = await loadModules(true);
    const { record, rawKey } = await keyStore.createBridgeKey('Temp', 'full');
    await keyStore.revokeBridgeKey(record.keyId);
    await expect(bridgeKey.authenticate(rawKey)).rejects.toMatchObject({ statusCode: 401 });
    const meta = await keyStore.listKeyMetadata();
    expect(meta.find((m) => m.keyId === record.keyId)?.enabled).toBe(false);
  });

  it('revoking an env key writes a KV shadow that wins the merge', async () => {
    const { bridgeKey, keyStore } = await loadModules(true);
    await keyStore.revokeBridgeKey('env-key-1');
    await expect(bridgeKey.authenticate(FAKE_ENV_RAW)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('revoking an unknown key 404s', async () => {
    const { keyStore } = await loadModules(true);
    await expect(keyStore.revokeBridgeKey('no-such-key')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

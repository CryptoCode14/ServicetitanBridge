import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

// Obviously fake credentials — test fixtures only, never real values.
const FAKE_USERNAME = 'test-owner';
const FAKE_PASSWORD = 'fake-password-for-tests-only';

const BASE_ENV: Record<string, string> = {
  ST_ENVIRONMENT: 'integration',
  ST_CLIENT_ID: 'fake-client-id',
  ST_CLIENT_SECRET: 'fake-client-secret',
  ST_APP_KEY: 'fake-app-key',
  ST_TENANT_ID: '123456789',
  BRIDGE_KEY_STORE: JSON.stringify([]),
};

let kvData: Map<string, string>;

function stubKvFetch() {
  kvData = new Map();
  const fetchStub = vi.fn(async (_url: unknown, init: { body: string }) => {
    const command = JSON.parse(init.body) as string[];
    const [op, key, value, flag] = command;
    if (op === 'GET') {
      return { ok: true, json: async () => ({ result: kvData.get(key) ?? null }) };
    }
    if (op === 'SET') {
      if (flag === 'NX' && kvData.has(key)) {
        return { ok: true, json: async () => ({ result: null }) };
      }
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
  return await import('./admin.js');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe('without KV connected', () => {
  it('setup refuses with the shared 503', async () => {
    const admin = await loadModules(false);
    await expect(admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD)).rejects.toMatchObject({
      statusCode: 503,
      code: 'KEY_STORE_NOT_CONFIGURED',
    });
  });

  it('no admin exists and no session can verify', async () => {
    const admin = await loadModules(false);
    expect(await admin.adminExists()).toBe(false);
    expect(await admin.verifySessionToken('whatever.whatever')).toBeNull();
  });
});

describe('admin setup', () => {
  it('creates the admin, storing only a salted scrypt hash', async () => {
    const admin = await loadModules(true);
    const record = await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    expect(record.username).toBe(FAKE_USERNAME);

    const stored = kvData.get('admin:user') ?? '';
    expect(stored).toContain(FAKE_USERNAME);
    expect(stored).not.toContain(FAKE_PASSWORD);
    expect(JSON.parse(stored).passwordHash).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.parse(stored).passwordSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(await admin.adminExists()).toBe(true);
  });

  it('locks out a second setup with 409', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    await expect(admin.setupAdmin('someone-else', FAKE_PASSWORD)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ALREADY_EXISTS',
    });
  });

  it('rejects a short username and a short password with 400', async () => {
    const admin = await loadModules(true);
    await expect(admin.setupAdmin('ab', FAKE_PASSWORD)).rejects.toMatchObject({ statusCode: 400 });
    await expect(admin.setupAdmin(FAKE_USERNAME, 'short')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('admin login verification', () => {
  it('accepts the right password and rejects everything else', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    expect(await admin.verifyAdminCredentials(FAKE_USERNAME, FAKE_PASSWORD)).toBe(FAKE_USERNAME);
    expect(await admin.verifyAdminCredentials(FAKE_USERNAME, 'wrong-password-here')).toBeNull();
    expect(await admin.verifyAdminCredentials('no-such-user', FAKE_PASSWORD)).toBeNull();
    expect(await admin.verifyAdminCredentials(FAKE_USERNAME, '')).toBeNull();
  });
});

describe('sessions', () => {
  it('issues a token that verifies back to the username', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    const token = await admin.createSessionToken(FAKE_USERNAME);
    expect(await admin.verifySessionToken(token)).toBe(FAKE_USERNAME);

    const viaCookie = await admin.sessionUsernameFromCookieHeader(
      `other=1; ${admin.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
    );
    expect(viaCookie).toBe(FAKE_USERNAME);
  });

  it('rejects a tampered token', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    const token = await admin.createSessionToken(FAKE_USERNAME);
    const [payload, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await admin.verifySessionToken(`${payload}.${flipped}`)).toBeNull();

    // Forged payload (different user) under the real signature also fails.
    const forgedPayload = Buffer.from(
      JSON.stringify({ u: 'attacker', exp: Date.now() + 60_000 }),
      'utf8'
    ).toString('base64url');
    expect(await admin.verifySessionToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    await admin.createSessionToken(FAKE_USERNAME); // forces secret creation
    const secret = kvData.get('admin:session-secret');
    expect(secret).toBeTruthy();
    const payloadB64 = Buffer.from(
      JSON.stringify({ u: FAKE_USERNAME, exp: Date.now() - 1_000 }),
      'utf8'
    ).toString('base64url');
    const sig = createHmac('sha256', secret as string).update(payloadB64, 'utf8').digest('base64url');
    expect(await admin.verifySessionToken(`${payloadB64}.${sig}`)).toBeNull();
  });

  it('rejects garbage tokens', async () => {
    const admin = await loadModules(true);
    await admin.setupAdmin(FAKE_USERNAME, FAKE_PASSWORD);
    expect(await admin.verifySessionToken('')).toBeNull();
    expect(await admin.verifySessionToken('not-a-token')).toBeNull();
    expect(await admin.verifySessionToken(null)).toBeNull();
    expect(await admin.verifySessionToken(undefined)).toBeNull();
  });

  it('session cookie headers carry the required attributes', async () => {
    const admin = await loadModules(true);
    const header = admin.sessionCookieHeader('tok.en');
    expect(header).toContain(`${admin.SESSION_COOKIE_NAME}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=604800');
    expect(admin.clearSessionCookieHeader()).toContain('Max-Age=0');
  });
});

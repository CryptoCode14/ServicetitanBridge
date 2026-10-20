import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Obviously fake credentials/keys — test fixtures only, never real values.
const FAKE_USERNAME = 'test-owner';
const FAKE_PASSWORD = 'fake-password-for-tests-only';
const FULL_RAW = 'stb_live_FAKE_FULL_KEY_FOR_TESTS_ONLY_111';
const RESTRICTED_RAW = 'stb_live_FAKE_RESTRICTED_KEY_FOR_TESTS_222';

function digestOf(raw: string): string {
  return 'sha256:' + createHash('sha256').update(raw, 'utf8').digest('hex');
}

const BASE_ENV: Record<string, string> = {
  ST_ENVIRONMENT: 'integration',
  ST_CLIENT_ID: 'fake-client-id',
  ST_CLIENT_SECRET: 'fake-client-secret',
  ST_APP_KEY: 'fake-app-key',
  ST_TENANT_ID: '123456789',
  BRIDGE_KEY_STORE: JSON.stringify([
    {
      keyId: 'env-full-1',
      name: 'Env Full Key',
      digest: digestOf(FULL_RAW),
      enabled: true,
      expiresAt: null,
      // no scope: grandfathered full
    },
    {
      keyId: 'env-restricted-1',
      name: 'Env Restricted Key',
      digest: digestOf(RESTRICTED_RAW),
      enabled: true,
      expiresAt: null,
      scope: 'restricted',
    },
  ]),
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

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): MockRes;
  json(b: unknown): MockRes;
  send(b: unknown): MockRes;
  setHeader(k: string, v: string): MockRes;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
  };
  return res;
}

function mockReq(opts: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return {
    url: opts.url,
    method: opts.method,
    headers: opts.headers ?? {},
    body: opts.body,
  };
}

type Handler = (req: unknown, res: MockRes) => Promise<unknown>;

async function loadHandler(withKv: boolean): Promise<Handler> {
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
  const mod = await import('../../api/v1/[...route].js');
  return mod.default as unknown as Handler;
}

function sessionCookieFrom(res: MockRes): string {
  const setCookie = res.headers['set-cookie'] ?? '';
  const match = setCookie.match(/bridge_admin_session=([^;]*)/);
  expect(match, 'expected a session Set-Cookie header').toBeTruthy();
  return `bridge_admin_session=${match![1]}`;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe('admin auth flow (KV connected)', () => {
  it('session reports needsSetup before setup, then authenticated after', async () => {
    const handler = await loadHandler(true);

    let res = mockRes();
    await handler(mockReq({ url: '/v1/admin/session', method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ needsSetup: true, authenticated: false });

    res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    const cookie = sessionCookieFrom(res);

    res = mockRes();
    await handler(mockReq({ url: '/v1/admin/session', method: 'GET', headers: { cookie } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      needsSetup: false,
      authenticated: true,
      username: FAKE_USERNAME,
    });
  });

  it('a second setup attempt is refused with 409', async () => {
    const handler = await loadHandler(true);
    let res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(201);

    res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: 'intruder', password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(409);
  });

  it('login: wrong password gets a generic 401 and no session; right password logs in', async () => {
    const handler = await loadHandler(true);
    let res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(201);

    res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/login',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: 'definitely-wrong-password' },
      }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'INVALID_CREDENTIALS' });
    expect(res.headers['set-cookie']).toBeUndefined();

    res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/login',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    sessionCookieFrom(res);
  });

  it('logout clears the cookie', async () => {
    const handler = await loadHandler(true);
    const res = mockRes();
    await handler(mockReq({ url: '/v1/admin/logout', method: 'POST' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
  });
});

describe('key management authorization', () => {
  async function setupAndCookie(handler: Handler): Promise<string> {
    const res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    return sessionCookieFrom(res);
  }

  it('a valid admin session authorizes the key list (no API key involved)', async () => {
    const handler = await loadHandler(true);
    const cookie = await setupAndCookie(handler);
    const res = mockRes();
    await handler(mockReq({ url: '/v1/admin/keys', method: 'GET', headers: { cookie } }), res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { keys: unknown[] };
    expect(body.keys).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('sha256');
  });

  it('a tampered session cookie is rejected with 401', async () => {
    const handler = await loadHandler(true);
    const cookie = await setupAndCookie(handler);
    const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const res = mockRes();
    await handler(
      mockReq({ url: '/v1/admin/keys', method: 'GET', headers: { cookie: tampered } }),
      res
    );
    expect(res.statusCode).toBe(401);
  });

  it('the full API key path still works (regression)', async () => {
    const handler = await loadHandler(true);
    const res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/keys',
        method: 'GET',
        headers: { authorization: `Bearer ${FULL_RAW}` },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { keys: unknown[] }).keys).toHaveLength(2);
  });

  it('a restricted API key still gets 403 and no auth gets 401', async () => {
    const handler = await loadHandler(true);
    let res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/keys',
        method: 'GET',
        headers: { authorization: `Bearer ${RESTRICTED_RAW}` },
      }),
      res
    );
    expect(res.statusCode).toBe(403);

    res = mockRes();
    await handler(mockReq({ url: '/v1/admin/keys', method: 'GET' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('a session can create a key and the raw key comes back exactly once', async () => {
    const handler = await loadHandler(true);
    const cookie = await setupAndCookie(handler);
    const res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/keys',
        method: 'POST',
        headers: { cookie },
        body: { name: 'Session Created', scope: 'restricted' },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    const body = res.body as { apiKey: string; key: { name: string } };
    expect(body.apiKey.startsWith('stb_live_')).toBe(true);
    expect(body.key.name).toBe('Session Created');

    const listed = mockRes();
    await handler(
      mockReq({ url: '/v1/admin/keys', method: 'GET', headers: { cookie } }),
      listed
    );
    expect(JSON.stringify(listed.body)).not.toContain(body.apiKey);
    expect(JSON.stringify(listed.body)).not.toContain('sha256');
  });
});

describe('without KV connected', () => {
  it('setup and session report the shared 503, key list still works by API key', async () => {
    const handler = await loadHandler(false);

    let res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/setup',
        method: 'POST',
        body: { username: FAKE_USERNAME, password: FAKE_PASSWORD },
      }),
      res
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: 'KEY_STORE_NOT_CONFIGURED' });

    res = mockRes();
    await handler(mockReq({ url: '/v1/admin/session', method: 'GET' }), res);
    expect(res.statusCode).toBe(503);

    res = mockRes();
    await handler(
      mockReq({
        url: '/v1/admin/keys',
        method: 'GET',
        headers: { authorization: `Bearer ${FULL_RAW}` },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
  });
});

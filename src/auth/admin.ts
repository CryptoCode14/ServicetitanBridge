import {
  randomBytes,
  scrypt as scryptCallback,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';
import {
  kvConfigured,
  kvGetString,
  kvSetString,
  kvSetStringIfAbsent,
  keyStoreNotConfiguredError,
} from './key-store.js';

const scrypt = promisify(scryptCallback);

/**
 * Admin account + session for the /keys page.
 *
 * Why this exists: the bridge owner has no copy of any raw API key (keys are
 * shown exactly once at creation), so a page that asks him to paste a
 * full-access key locks him out of his own tool. Instead the page uses a
 * username/password admin login. This is a one-owner tool: a single admin
 * record in KV, created through a one-time setup endpoint that locks itself
 * (409) the moment an admin exists.
 *
 * Storage (KV):
 * - `admin:user` — { username, passwordSalt, passwordHash, createdAt }.
 *   The password is hashed with scrypt + a per-user random salt. Plaintext
 *   is never stored and never logged.
 * - `admin:session-secret` — random HMAC key for signing session cookies,
 *   generated once on first use. Never leaves the server.
 *
 * Sessions are signed cookies: base64url(JSON {u, exp}) + '.' +
 * base64url(HMAC-SHA256(secret, payload)). HttpOnly + Secure + SameSite=Lax,
 * 7-day expiry, verified (signature + expiry) on every admin request.
 */

const ADMIN_USER_KEY = 'admin:user';
const SESSION_SECRET_KEY = 'admin:session-secret';
export const SESSION_COOKIE_NAME = 'bridge_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminUserRecord {
  username: string;
  passwordSalt: string; // hex
  passwordHash: string; // hex (scrypt, 64 bytes)
  createdAt: string;
}

function requireKv(): void {
  if (!kvConfigured()) throw keyStoreNotConfiguredError();
}

// ---------------------------------------------------------------------------
// Admin account
// ---------------------------------------------------------------------------

export async function loadAdminUser(): Promise<AdminUserRecord | null> {
  if (!kvConfigured()) return null;
  const raw = await kvGetString(ADMIN_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminUserRecord;
    if (typeof parsed.username === 'string' && typeof parsed.passwordHash === 'string') {
      return parsed;
    }
  } catch {
    // Corrupt record: treat as no admin rather than crashing auth.
    console.error('Failed to parse admin user record');
  }
  return null;
}

export async function adminExists(): Promise<boolean> {
  return (await loadAdminUser()) !== null;
}

async function hashPassword(password: string, saltHex: string): Promise<Buffer> {
  return (await scrypt(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer;
}

/**
 * One-time setup. Throws 409 once an admin exists — there is deliberately no
 * way to create a second admin or reset this one through the API.
 */
export async function setupAdmin(username: unknown, password: unknown): Promise<AdminUserRecord> {
  requireKv();
  const name = typeof username === 'string' ? username.trim() : '';
  if (name.length < 3 || name.length > 50) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Username must be 3-50 characters.');
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Password must be at least 10 characters.');
  }
  if (await adminExists()) {
    throw new HttpError(
      409,
      'ADMIN_ALREADY_EXISTS',
      'An admin account already exists. Log in with it instead.'
    );
  }
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  const record: AdminUserRecord = {
    username: name,
    passwordSalt: salt,
    passwordHash: hash.toString('hex'),
    createdAt: new Date().toISOString(),
  };
  await kvSetString(ADMIN_USER_KEY, JSON.stringify(record));
  return record;
}

/**
 * Verify a login attempt. Returns the username on success, null on any
 * failure — callers must not reveal which field was wrong. A scrypt run
 * happens even for unknown users so timing stays roughly uniform.
 */
export async function verifyAdminCredentials(
  username: unknown,
  password: unknown
): Promise<string | null> {
  requireKv();
  const name = typeof username === 'string' ? username.trim() : '';
  const pass = typeof password === 'string' ? password : '';
  const user = await loadAdminUser();
  if (!user || user.username !== name) {
    await hashPassword(pass || 'dummy', randomBytes(16).toString('hex'));
    return null;
  }
  const candidate = await hashPassword(pass, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, 'hex');
  if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
    return user.username;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sessions (signed cookies)
// ---------------------------------------------------------------------------

let sessionSecretCache: string | null = null;

async function getSessionSecret(): Promise<string> {
  if (sessionSecretCache) return sessionSecretCache;
  requireKv();
  const existing = await kvGetString(SESSION_SECRET_KEY);
  if (existing) {
    sessionSecretCache = existing;
    return existing;
  }
  const generated = randomBytes(32).toString('hex');
  // SET NX so concurrent first-uses converge on one secret, then read back
  // the winner (which may be another instance's value).
  await kvSetStringIfAbsent(SESSION_SECRET_KEY, generated);
  const stored = await kvGetString(SESSION_SECRET_KEY);
  sessionSecretCache = stored ?? generated;
  return sessionSecretCache;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64, 'utf8').digest('base64url');
}

export async function createSessionToken(username: string): Promise<string> {
  const secret = await getSessionSecret();
  const payload = { u: username, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Returns the session's username, or null for any invalid/expired/tampered token. */
export async function verifySessionToken(token: string | null | undefined): Promise<string | null> {
  if (!token || !kvConfigured()) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  let secret: string;
  try {
    secret = await getSessionSecret();
  } catch {
    return null;
  }
  const expected = sign(payloadB64, secret);
  const givenBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (givenBuf.length !== expectedBuf.length || !timingSafeEqual(givenBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      u?: unknown;
      exp?: unknown;
    };
    if (typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload.u;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie plumbing (framework-thin: works off the raw Cookie header)
// ---------------------------------------------------------------------------

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) {
      try {
        out[name] = decodeURIComponent(value);
      } catch {
        out[name] = value;
      }
    }
  }
  return out;
}

export async function sessionUsernameFromCookieHeader(
  cookieHeader: string | string[] | undefined
): Promise<string | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieHeader(token: string): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

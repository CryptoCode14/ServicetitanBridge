import { createHash } from 'node:crypto';
import { HttpError } from '../auth/bridge-key.js';

// In-memory mock database for idempotency. 
// For production, replace this with a PostgreSQL or Redis client.
const mockDb = new Map<string, { hash: string, response: any, status: string }>();

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function withIdempotency(
  keyId: string, 
  method: string, 
  path: string, 
  idempotencyKey: string, 
  body: any, 
  action: () => Promise<any>
): Promise<any> {
  const bodyString = JSON.stringify(body);
  const bodyHash = digest(bodyString);
  const storageKey = digest(`${keyId}:${method}:${path}:${idempotencyKey}`);

  const existing = mockDb.get(storageKey);
  if (existing) {
    if (existing.hash !== bodyHash) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Same key used with a different request payload.');
    }
    if (existing.status === 'completed') {
       return { ...existing.response, _idempotencyReplayed: true };
    }
    throw new HttpError(409, 'IDEMPOTENCY_PENDING', 'A request with this key is already in progress.');
  }

  mockDb.set(storageKey, { hash: bodyHash, response: null, status: 'pending' });

  try {
    const result = await action();
    mockDb.set(storageKey, { hash: bodyHash, response: result, status: 'completed' });
    return result;
  } catch (err) {
    mockDb.set(storageKey, { hash: bodyHash, response: null, status: 'failed' });
    throw err;
  }
}

import { config, hosts } from '../config.js';
import { getToken } from './token-manager.js';

export async function stRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const url = hosts[config.ST_ENVIRONMENT] + path;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'ST-App-Key': config.ST_APP_KEY,
    'Accept': 'application/json'
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.UPSTREAM_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Upstream Error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

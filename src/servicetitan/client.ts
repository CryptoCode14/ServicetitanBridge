import { config, hosts } from '../config.js';
import { getToken, invalidateToken } from './token-manager.js';
import { HttpError } from '../auth/bridge-key.js';

export async function stRequest<T>(method: string, path: string, body?: unknown, forceRefresh = false): Promise<any> {
  if (forceRefresh) {
    invalidateToken();
  }

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

  if (response.status === 401 && !forceRefresh) {
    // Retry once
    return stRequest(method, path, body, true);
  }

  if (!response.ok) {
    throw new HttpError(response.status === 429 ? 429 : 502, 'UPSTREAM_FAILURE', `Upstream Error: ${response.status}`);
  }

  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return {};
  }
}

export async function stProxyRequest(method: string, namespace: string, restOfPath: string, queryParams: string, body?: unknown): Promise<Response> {
  const path = `/${namespace}/v2/tenant/${config.ST_TENANT_ID}/${restOfPath}${queryParams ? '?' + queryParams : ''}`;
  
  const token = await getToken();
  const url = hosts[config.ST_ENVIRONMENT] + path;
  
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('ST-App-Key', config.ST_APP_KEY);
  headers.set('Accept', '*/*');

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(config.UPSTREAM_TIMEOUT_MS)
  };

  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers.set('Content-Type', 'application/json');
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let response = await fetch(url, fetchOptions);

  if (response.status === 401) {
    invalidateToken();
    const freshToken = await getToken();
    headers.set('Authorization', `Bearer ${freshToken}`);
    response = await fetch(url, fetchOptions);
  }

  // Sanitize headers to send back
  const responseHeaders = new Headers();
  const contentType = response.headers.get('Content-Type');
  if (contentType) {
    responseHeaders.set('Content-Type', contentType);
  } else {
    responseHeaders.set('Content-Type', 'application/json');
  }

  if (response.headers.has('Retry-After')) {
    responseHeaders.set('Retry-After', response.headers.get('Retry-After')!);
  }
  
  if (response.headers.has('Content-Disposition')) {
    responseHeaders.set('Content-Disposition', response.headers.get('Content-Disposition')!);
  }

  if (!response.ok) {
    if (contentType?.includes('application/json')) {
      const errorBody = await response.text();
      return new Response(errorBody || JSON.stringify({ 
        error: 'UPSTREAM_FAILURE', 
        status: response.status 
      }), { status: response.status === 429 ? 429 : 502, headers: responseHeaders });
    }
    return new Response(JSON.stringify({ 
      error: 'UPSTREAM_FAILURE', 
      status: response.status 
    }), { status: response.status === 429 ? 429 : 502, headers: responseHeaders });
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Response(arrayBuffer, { status: response.status, headers: responseHeaders });
}

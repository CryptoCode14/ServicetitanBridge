import { config, authHosts } from '../config.js';

let cached: { value: string; expiresAt: number } | undefined;
let inFlight: Promise<string> | undefined;

async function fetchToken(): Promise<{ access_token: string, expires_in: number }> {
  const url = `${authHosts[config.ST_ENVIRONMENT]}/connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.ST_CLIENT_ID,
    client_secret: config.ST_CLIENT_SECRET
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ServiceTitan token: ${res.status}`);
  }

  return res.json() as Promise<{ access_token: string, expires_in: number }>;
}

export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }
  if (inFlight) return inFlight;
  
  inFlight = fetchToken().then(({ access_token, expires_in }) => {
    cached = { 
      value: access_token,
      expiresAt: Date.now() + expires_in * 1000 
    };
    return access_token;
  }).finally(() => { 
    inFlight = undefined; 
  });
  
  return inFlight;
}

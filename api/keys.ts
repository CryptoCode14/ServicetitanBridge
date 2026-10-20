import type { VercelRequest, VercelResponse } from '@vercel/node';
import { KEYS_PAGE_HTML } from '../src/keys-page.js';

/**
 * Serves the API-key management page at /keys. The page itself is public
 * static HTML — all data flows through /v1/admin/*, which requires either
 * an admin session (username/password login) or a full-scope bridge key.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).send(KEYS_PAGE_HTML);
}

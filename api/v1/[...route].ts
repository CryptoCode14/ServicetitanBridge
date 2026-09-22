export const configEdge = {
  runtime: 'edge'
};

import { authenticate } from '../../src/auth/bridge-key.js';
import { config } from '../../src/config.js';
import { searchCustomers, getCustomer } from '../../src/servicetitan/customers.js';
import { listJobs, getJob } from '../../src/servicetitan/jobs.js';
import { createEstimateDraft } from '../../src/servicetitan/estimates.js';
import { CreateEstimateDraftRequestSchema } from '../../src/schemas/estimates.js';
import { HttpError } from '../../src/auth/bridge-key.js';

export default async function handler(req: Request) {
  try {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Health and public routes
    if (pathname === '/healthz') {
      return new Response(JSON.stringify({ status: 'ok' }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Authenticate all other routes
    const bridgeKey = req.headers.get('x-bridge-key');
    authenticate(bridgeKey);

    if (pathname === '/v1/whoami') {
      return new Response(JSON.stringify({ 
        client: 'known_client',
        environment: config.ST_ENVIRONMENT,
        capabilities: ['estimates:draft:create', 'customers:read', 'jobs:read']
      }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // ---------------------------------------------------------
    // Customers
    // ---------------------------------------------------------
    if (req.method === 'GET' && pathname === '/v1/customers') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
      const name = url.searchParams.get('name') || undefined;
      const result = await searchCustomers({ page, pageSize, name });
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const customerMatch = pathname.match(/^\/v1\/customers\/(\d+)$/);
    if (req.method === 'GET' && customerMatch) {
      const id = customerMatch[1];
      const result = await getCustomer(id);
      return new Response(JSON.stringify({ data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ---------------------------------------------------------
    // Jobs
    // ---------------------------------------------------------
    if (req.method === 'GET' && pathname === '/v1/jobs') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
      const status = url.searchParams.get('status') || undefined;
      const result = await listJobs({ page, pageSize, status });
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const jobMatch = pathname.match(/^\/v1\/jobs\/(\d+)$/);
    if (req.method === 'GET' && jobMatch) {
      const id = jobMatch[1];
      const result = await getJob(id);
      return new Response(JSON.stringify({ data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ---------------------------------------------------------
    // Estimates
    // ---------------------------------------------------------
    if (req.method === 'POST' && pathname === '/v1/estimate-drafts') {
      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for writes.');
      }
      
      const bodyText = await req.text();
      let bodyJson;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch (e) {
        throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
      }
      
      const parsedBody = CreateEstimateDraftRequestSchema.parse(bodyJson);
      const result = await createEstimateDraft(parsedBody, idempotencyKey);
      
      return new Response(JSON.stringify({ data: result }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { 
      status: 404, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    if (err.statusCode) {
      return new Response(JSON.stringify({ error: err.code, message: err.message }), { 
        status: err.statusCode, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    console.error("Unhandled Error:", err);
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

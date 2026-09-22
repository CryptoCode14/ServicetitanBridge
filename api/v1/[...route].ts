export const config = {
  runtime: 'edge'
};

import { authenticate, HttpError } from '../../src/auth/bridge-key.js';
import { config as appConfig } from '../../src/config.js';
import { stProxyRequest } from '../../src/servicetitan/client.js';
import { createJob, addJobNote, addAppointment } from '../../src/servicetitan/mutations.js';
import { JobNoteSchema, AppointmentSchema, CreateJobSchema } from '../../src/schemas/mutations.js';
import { createEstimateDraft } from '../../src/servicetitan/estimates.js';
import { CreateEstimateDraftRequestSchema } from '../../src/schemas/estimates.js';
import { withIdempotency } from '../../src/policy/idempotency.js';

export default async function handler(req: Request) {
  try {
    const url = new URL(req.url);
    let pathname = url.pathname;
    
    if (pathname === '/healthz' || pathname === '/v1/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'servicetitan-bridge' }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const bridgeKey = req.headers.get('x-bridge-key');
    const authContext = authenticate(bridgeKey);

    // ---------------------------------------------------------
    // GET PROXY
    // ---------------------------------------------------------
    if (req.method === 'GET' && pathname.startsWith('/v1/proxy/')) {
      const parts = pathname.replace('/v1/proxy/', '').split('/');
      const namespace = parts[0];
      const restOfPath = parts.slice(1).join('/');

      // Path hardening
      if (restOfPath.includes('..') || restOfPath.includes('\\') || restOfPath.includes('\0') || restOfPath.includes('//')) {
         throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid path segments.');
      }

      const allowedNamespaces = appConfig.ALLOWED_READ_NAMESPACES.split(',').map((n: string) => n.trim());
      if (!allowedNamespaces.includes(namespace)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Namespace not allowed.');
      }

      return await stProxyRequest('GET', namespace, restOfPath, url.searchParams.toString());
    }

    if (pathname.startsWith('/v1/proxy/') && req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { 
        status: 405, 
        headers: { 'Allow': 'GET', 'Content-Type': 'application/json' } 
      });
    }

    // ---------------------------------------------------------
    // EXPLICIT MUTATIONS (POST)
    // ---------------------------------------------------------
    if (req.method === 'POST') {
      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for writes.');
      }

      const bodyText = await req.text();
      let bodyJson;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch (e) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Request body is invalid.');
      }

      // POST /v1/jobs
      if (pathname === '/v1/jobs') {
        const parsedBody = CreateJobSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return createJob(parsedBody, idempotencyKey);
        });
        return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // POST /v1/jobs/:jobId/notes
      const noteMatch = pathname.match(/^\/v1\/jobs\/(\d+)\/notes$/);
      if (noteMatch) {
        const jobId = noteMatch[1];
        const parsedBody = JobNoteSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return addJobNote(jobId, parsedBody, idempotencyKey);
        });
        return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // POST /v1/appointments
      if (pathname === '/v1/appointments') {
        const parsedBody = AppointmentSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return addAppointment(parsedBody, idempotencyKey);
        });
        return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // POST /v1/estimate-drafts
      if (pathname === '/v1/estimate-drafts') {
        const parsedBody = CreateEstimateDraftRequestSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return createEstimateDraft(parsedBody, idempotencyKey);
        });
        return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { 
      status: 404, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    if (err.name === 'ZodError') {
      return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'Request body is invalid.', details: err.errors }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
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

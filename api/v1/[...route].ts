import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, HttpError } from '../../src/auth/bridge-key.js';
import { config as appConfig, validateConfig } from '../../src/config.js';
import { stProxyRequest } from '../../src/servicetitan/client.js';
import { createJob, addJobNote, addAppointment } from '../../src/servicetitan/mutations.js';
import { JobNoteSchema, AppointmentSchema, CreateJobSchema } from '../../src/schemas/mutations.js';
import { createEstimateDraft } from '../../src/servicetitan/estimates.js';
import { CreateEstimateDraftRequestSchema } from '../../src/schemas/estimates.js';
import { withIdempotency } from '../../src/policy/idempotency.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    let pathname = req.url ? req.url.split('?')[0] : '/';
    
    if (pathname === '/healthz' || pathname === '/v1/health' || pathname.endsWith('/healthz') || pathname.endsWith('/v1/health')) {
      return res.status(200).json({ status: 'ok', service: 'servicetitan-bridge' });
    }

    validateConfig();

    const bridgeKey = req.headers['x-bridge-key'] as string;
    const authContext = authenticate(bridgeKey);

    // ---------------------------------------------------------
    // GET PROXY
    // ---------------------------------------------------------
    if (req.method === 'GET' && pathname.includes('/v1/proxy/')) {
      const proxyIdx = pathname.indexOf('/v1/proxy/');
      const proxyPath = pathname.substring(proxyIdx + '/v1/proxy/'.length);
      const parts = proxyPath.split('/');
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

      const searchParams = req.url ? req.url.split('?')[1] || '' : '';
      const stResponse = await stProxyRequest('GET', namespace, restOfPath, searchParams);
      
      const responseData = await stResponse.json();
      return res.status(stResponse.status).json(responseData);
    }

    if (pathname.includes('/v1/proxy/') && req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // ---------------------------------------------------------
    // EXPLICIT MUTATIONS (POST)
    // ---------------------------------------------------------
    if (req.method === 'POST') {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      if (!idempotencyKey) {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for writes.');
      }

      const bodyJson = req.body;
      if (!bodyJson || typeof bodyJson !== 'object') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Request body is invalid.');
      }

      // POST /v1/jobs
      if (pathname.endsWith('/v1/jobs')) {
        const parsedBody = CreateJobSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return createJob(parsedBody, idempotencyKey);
        });
        return res.status(201).json(result);
      }

      // POST /v1/jobs/:jobId/notes
      const noteMatch = pathname.match(/\/v1\/jobs\/(\d+)\/notes$/);
      if (noteMatch) {
        const jobId = noteMatch[1];
        const parsedBody = JobNoteSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return addJobNote(jobId, parsedBody, idempotencyKey);
        });
        return res.status(201).json(result);
      }

      // POST /v1/appointments
      if (pathname.endsWith('/v1/appointments')) {
        const parsedBody = AppointmentSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return addAppointment(parsedBody, idempotencyKey);
        });
        return res.status(201).json(result);
      }

      // POST /v1/estimate-drafts
      if (pathname.endsWith('/v1/estimate-drafts')) {
        const parsedBody = CreateEstimateDraftRequestSchema.parse(bodyJson);
        const result = await withIdempotency(authContext.keyId, 'POST', pathname, idempotencyKey, parsedBody, () => {
          return createEstimateDraft(parsedBody, idempotencyKey);
        });
        return res.status(201).json(result);
      }
    }

    return res.status(404).json({ error: 'NOT_FOUND' });

  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Request body is invalid.', details: err.errors });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    if (err.message?.includes("Invalid environment configuration")) {
      return res.status(500).json({ error: 'ENVIRONMENT_CONFIGURATION_ERROR', message: err.message });
    }
    console.error("Unhandled Error:", err);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
}

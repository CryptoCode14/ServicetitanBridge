import { stRequest } from './client.js';
import { config } from '../config.js';
import { CreateEstimateDraftRequest, EstimateResponseSchema, EstimateResponse } from '../schemas/estimates.js';
import { HttpError } from '../auth/bridge-key.js';

export async function createEstimateDraft(req: CreateEstimateDraftRequest, idempotencyKey: string): Promise<EstimateResponse> {
  if (config.WRITE_MODE !== 'draft_estimates') {
    throw new HttpError(403, 'WRITE_MODE_DISABLED', 'Draft writes are currently disabled in configuration.');
  }

  // TODO: Add durable idempotency check using a database (e.g. Supabase) with the idempotencyKey.
  // Example: 
  // const existing = await db.getIdempotency(idempotencyKey);
  // if (existing) return existing.response;

  const path = `/sales/v2/tenant/${config.ST_TENANT_ID}/estimates`;
  
  // Transform to Vendor Schema.
  const payload = {
    jobId: parseInt(req.jobId, 10),
    name: req.name,
    summary: req.summary || '',
    items: req.items.map(item => ({
      skuId: parseInt(item.skuId, 10),
      quantity: parseFloat(item.quantity),
      unitPrice: parseFloat(item.unitPrice)
    }))
  };

  const rawResponse = await stRequest<any>('POST', path, payload);
  
  const mappedResponse = EstimateResponseSchema.parse({
    id: String(rawResponse.id),
    status: rawResponse.status || 'Open',
    jobId: String(rawResponse.jobId),
    requiresHumanReview: true
  });

  // TODO: Store the mappedResponse in the durable idempotency ledger here before returning.
  
  return mappedResponse;
}

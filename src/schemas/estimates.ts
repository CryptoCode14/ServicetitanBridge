import { z } from 'zod';

export const EstimateItemSchema = z.object({
  skuId: z.string(),
  quantity: z.string().or(z.number()).transform(v => String(v)),
  unitPrice: z.string().or(z.number()).transform(v => String(v))
});

export const CreateEstimateDraftRequestSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  summary: z.string().nullable().optional(),
  items: z.array(EstimateItemSchema).default([])
});

export const EstimateResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  jobId: z.string(),
  requiresHumanReview: z.boolean().default(true)
});

export type CreateEstimateDraftRequest = z.infer<typeof CreateEstimateDraftRequestSchema>;
export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;

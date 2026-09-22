import { z } from 'zod';

export const RequestIdSchema = z.string().uuid();

export const StandardEnvelopeSchema = z.object({
  data: z.any(),
  meta: z.object({
    requestId: z.string(),
    environment: z.string(),
    nextPage: z.string().nullable().optional()
  })
});

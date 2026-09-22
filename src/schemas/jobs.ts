import { z } from 'zod';

export const JobSchema = z.object({
  id: z.string(),
  number: z.string(),
  customerId: z.string(),
  locationId: z.string().optional(),
  status: z.string(),
  summary: z.string().nullable().optional(),
});

export type Job = z.infer<typeof JobSchema>;

export const JobListResponseSchema = z.object({
  data: z.array(JobSchema),
  hasMore: z.boolean(),
  totalCount: z.number().optional()
});

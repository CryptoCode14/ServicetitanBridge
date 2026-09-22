import { z } from 'zod';

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export type Customer = z.infer<typeof CustomerSchema>;

export const CustomerListResponseSchema = z.object({
  data: z.array(CustomerSchema),
  hasMore: z.boolean(),
  totalCount: z.number().optional()
});

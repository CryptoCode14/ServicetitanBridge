import { z } from 'zod';

export const JobNoteSchema = z.object({
  text: z.string().min(1),
  pinToTop: z.boolean().optional()
});

export const AppointmentSchema = z.object({
  jobId: z.number().int().positive(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  arrivalWindowStart: z.string().datetime(),
  arrivalWindowEnd: z.string().datetime(),
  technicianIds: z.array(z.number().int().positive()).min(1),
  specialInstructions: z.string().optional()
});

export const CreateJobSchema = z.object({
  customerId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  businessUnitId: z.number().int().positive(),
  jobTypeId: z.number().int().positive(),
  priority: z.enum(['Low', 'Normal', 'High', 'Urgent']),
  summary: z.string().max(2000).optional(),
  scheduledWindow: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    arrivalWindowStart: z.string().datetime(),
    arrivalWindowEnd: z.string().datetime()
  }).optional(),
  assignedTechnicianIds: z.array(z.number().int().positive()).optional(),
  initialNotes: z.array(z.string()).optional()
});

export type JobNoteRequest = z.infer<typeof JobNoteSchema>;
export type AppointmentRequest = z.infer<typeof AppointmentSchema>;
export type CreateJobRequest = z.infer<typeof CreateJobSchema>;

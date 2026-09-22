import { stRequest } from './client.js';
import { config } from '../config.js';
import { JobListResponseSchema, Job } from '../schemas/jobs.js';

export async function listJobs(params: { page?: number, pageSize?: number, status?: string }): Promise<{ data: Job[], hasMore: boolean }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.pageSize) searchParams.set('pageSize', params.pageSize.toString());
  if (params.status) searchParams.set('status', params.status);

  // Dispatch API endpoint from our reference
  const path = `/dispatch/v2/tenant/${config.ST_TENANT_ID}/jobs?${searchParams.toString()}`;
  
  const rawResponse = await stRequest<any>('GET', path);
  
  const mappedData = (rawResponse.data || []).map((j: any) => ({
    id: String(j.id),
    number: String(j.number || j.id),
    customerId: String(j.customerId),
    locationId: j.locationId ? String(j.locationId) : undefined,
    status: j.status,
    summary: j.summary || null
  }));

  return JobListResponseSchema.parse({
    data: mappedData,
    hasMore: rawResponse.hasMore || false,
    totalCount: rawResponse.totalCount
  });
}

export async function getJob(id: string): Promise<Job> {
  const path = `/dispatch/v2/tenant/${config.ST_TENANT_ID}/jobs/${id}`;
  const rawResponse = await stRequest<any>('GET', path);
  
  return {
    id: String(rawResponse.id),
    number: String(rawResponse.number || rawResponse.id),
    customerId: String(rawResponse.customerId),
    locationId: rawResponse.locationId ? String(rawResponse.locationId) : undefined,
    status: rawResponse.status,
    summary: rawResponse.summary || null
  };
}

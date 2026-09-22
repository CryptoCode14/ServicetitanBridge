import { stRequest } from './client.js';
import { config } from '../config.js';
import { CustomerListResponseSchema, Customer } from '../schemas/customers.js';

export async function searchCustomers(params: { page?: number, pageSize?: number, name?: string }): Promise<{ data: Customer[], hasMore: boolean }> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.pageSize) searchParams.set('pageSize', params.pageSize.toString());
  if (params.name) searchParams.set('name', params.name);

  // CRM API endpoint from our reference
  const path = `/crm/v2/tenant/${config.ST_TENANT_ID}/customers?${searchParams.toString()}`;
  
  const rawResponse = await stRequest<any>('GET', path);
  
  // Transform ServiceTitan response to canonical schema
  const mappedData = (rawResponse.data || []).map((c: any) => ({
    id: String(c.id),
    name: c.name || 'Unknown',
    type: c.type,
    email: c.email || null,
    phone: c.phone || null
  }));

  return CustomerListResponseSchema.parse({
    data: mappedData,
    hasMore: rawResponse.hasMore || false,
    totalCount: rawResponse.totalCount
  });
}

export async function getCustomer(id: string): Promise<Customer> {
  const path = `/crm/v2/tenant/${config.ST_TENANT_ID}/customers/${id}`;
  const rawResponse = await stRequest<any>('GET', path);
  
  return {
    id: String(rawResponse.id),
    name: rawResponse.name || 'Unknown',
    type: rawResponse.type,
    email: rawResponse.email || null,
    phone: rawResponse.phone || null
  };
}

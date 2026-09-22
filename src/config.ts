import { z } from 'zod';

const envSchema = z.object({
  ST_ENVIRONMENT: z.enum(['integration', 'production']),
  ST_CLIENT_ID: z.string().min(1),
  ST_CLIENT_SECRET: z.string().min(1),
  ST_APP_KEY: z.string().min(1),
  ST_TENANT_ID: z.string().regex(/^\d+$/),
  BRIDGE_KEY_STORE: z.string().min(2), // JSON string
  ALLOWED_READ_NAMESPACES: z.string().default('crm,jpm,dispatch,accounting,payroll,timesheets,pricebook,inventory'),
  WRITE_MODE: z.enum(['off', 'draft_estimates', 'all']).default('off'),
  LOG_LEVEL: z.enum(['info', 'debug']).default('info'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(15000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Environment Validation Error:", parsed.error.format());
  throw new Error("Invalid environment configuration.");
}

export const config = parsed.data;

export const hosts = {
  integration: 'https://api-integration.servicetitan.io',
  production: 'https://api.servicetitan.io'
} as const;

export const authHosts = {
  integration: 'https://auth-integration.servicetitan.io',
  production: 'https://auth.servicetitan.io'
} as const;

// Invariants
if (config.ST_ENVIRONMENT === 'production') {
  // Can add prod specific checks here
}

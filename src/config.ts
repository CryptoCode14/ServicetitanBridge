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
  // Optional: injected automatically when a Vercel KV (Upstash) store is
  // connected to the project. When absent, the writable key store is disabled
  // and authentication uses the env BRIDGE_KEY_STORE alone (original behavior).
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse({
  ST_ENVIRONMENT: process.env.ST_ENVIRONMENT,
  ST_CLIENT_ID: process.env.ST_CLIENT_ID,
  ST_CLIENT_SECRET: process.env.ST_CLIENT_SECRET,
  ST_APP_KEY: process.env.ST_APP_KEY,
  ST_TENANT_ID: process.env.ST_TENANT_ID,
  BRIDGE_KEY_STORE: process.env.BRIDGE_KEY_STORE,
  ALLOWED_READ_NAMESPACES: process.env.ALLOWED_READ_NAMESPACES,
  WRITE_MODE: process.env.WRITE_MODE,
  LOG_LEVEL: process.env.LOG_LEVEL,
  UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
});

export const configError = parsed.success ? null : parsed.error;
export const config = (parsed.success ? parsed.data : {}) as z.infer<typeof envSchema>;

export function validateConfig() {
  if (configError) {
    throw new Error("Invalid environment configuration: " + configError.message);
  }
}

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

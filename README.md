# ServiceTitan Bridge

A secure, headless, API-only service connecting AI assistants (like Muse and Gus) to ServiceTitan without exposing ServiceTitan credentials.

## Overview
This Vercel-deployed serverless application handles:
1. Validating caller identities with strict, constant-time `X-Bridge-Key` authentication.
2. Acquiring and caching short-lived ServiceTitan OAuth tokens.
3. Providing narrow, canonical REST endpoints for approved data structures (Customers, Jobs, Draft Estimates).
4. Enforcing strict read/write policy modes (e.g. `WRITE_MODE=off` vs `draft_estimates`).
5. Idempotency guarantees for all structural writes.

## Local Setup & Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Generate a local bridge key:**
   ```bash
   node scripts/generate-bridge-key.mjs test
   ```

3. **Configure environment:**
   Create a `.env` file at the root containing:
   ```env
   ST_ENVIRONMENT=integration
   ST_CLIENT_ID=your_client_id
   ST_CLIENT_SECRET=your_client_secret
   ST_APP_KEY=your_app_key
   ST_TENANT_ID=123456789
   BRIDGE_API_KEY=stb_test_xxxxxxxxxx
   WRITE_MODE=draft_estimates
   ```

4. **Type Check:**
   ```bash
   npx tsc --noEmit
   ```

## Deployment (Vercel)
This project is configured to deploy instantly on Vercel Edge functions via the `vercel.json` and `api/v1/[...route].ts` setup.

### Production Release Strategy
1. **Integration Read-Only**: Deploy pointing to ST Integration. Set `WRITE_MODE=off`.
2. **Integration Writes**: Set `WRITE_MODE=draft_estimates` and test `/v1/estimate-drafts` idempotency.
3. **Production Read-Only**: Create a separate Vercel project, use `stb_live_` keys, connect to ST Production, and set `WRITE_MODE=off`.
4. **Production Writes**: Only when fully verified, set `WRITE_MODE=draft_estimates`.

## OpenAPI Contract
See `openapi/bridge.openapi.yaml` for the strict API interface you should load into Muse.

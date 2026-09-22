# ServiceTitan API Reference

## 1. Overview
The ServiceTitan API allows developers to integrate with ServiceTitan's core modules such as CRM, Dispatch, Job Booking, and Accounting. The API is RESTful and uses standard HTTP methods (GET, POST, PUT, PATCH, DELETE).

## 2. Authentication
ServiceTitan uses OAuth 2.0 with a Client Credentials grant type.

### Obtaining an Access Token
**Endpoint**: `POST https://auth.servicetitan.io/connect/token`

**Headers:**
- `Content-Type: application/x-www-form-urlencoded`

**Form Data:**
- `grant_type`: `client_credentials`
- `client_id`: Your Client ID
- `client_secret`: Your Client Secret

**Response:**
```json
{
  "access_token": "eyJhbG...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### Making Authenticated Requests
All API requests must include the Bearer token in the `Authorization` header, and your `ST-App-Key` in the custom header.
- `Authorization: Bearer <access_token>`
- `ST-App-Key: <your_app_key>`

## 3. Pagination
ServiceTitan uses offset-based pagination for listing resources.
- `page`: The page number to retrieve (default is 1).
- `pageSize`: The number of records per page (max varies by endpoint, often 50 or 100).

**Example Response:**
```json
{
  "data": [ ... ],
  "page": 1,
  "pageSize": 50,
  "hasMore": true,
  "totalCount": 1500
}
```

## 4. Rate Limiting
ServiceTitan API enforces rate limits per tenant/app key.
- If you exceed the rate limit, the API responds with `429 Too Many Requests`.
- Wait for the duration specified in the `Retry-After` header before making subsequent requests.

## 5. Key Endpoints

### 5.1 CRM
**Get Customers:**
`GET /crm/v2/tenant/{tenant}/customers`
Retrieves a list of customers.

**Get Locations:**
`GET /crm/v2/tenant/{tenant}/locations`
Retrieves a list of locations associated with customers.

### 5.2 Dispatch
**Get Jobs:**
`GET /dispatch/v2/tenant/{tenant}/jobs`
Retrieves a list of jobs. Can be filtered by `status`, `startsOnOrAfter`, etc.

**Get Technicians:**
`GET /dispatch/v2/tenant/{tenant}/technicians`
Retrieves a list of technicians.

### 5.3 Accounting
**Get Invoices:**
`GET /accounting/v2/tenant/{tenant}/invoices`
Retrieves a list of invoices.

**Get Payments:**
`GET /accounting/v2/tenant/{tenant}/payments`
Retrieves a list of payments.

## 6. Standard Error Responses
ServiceTitan uses standard HTTP status codes:
- `400 Bad Request`: Invalid parameters or validation errors.
- `401 Unauthorized`: Invalid or expired access token.
- `403 Forbidden`: Insufficient permissions or incorrect App Key.
- `404 Not Found`: The requested resource does not exist.
- `429 Too Many Requests`: Rate limit exceeded.
- `500 Internal Server Error`: Server-side error.

Error responses typically include a JSON body with a `type`, `title`, `status`, `detail`, and `traceId` (following RFC 7807 Problem Details).

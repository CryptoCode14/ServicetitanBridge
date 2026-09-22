import { config } from 'dotenv';
// config({ path: '.env.example' });

// static import removed

async function run() {
  const req = {
    url: '/v1/proxy/crm/customers',
    query: {},
    headers: {},
    method: 'GET'
  } as any;

  const res = {
    status: (code) => {
      console.log('STATUS:', code);
      return res;
    },
    json: (data) => {
      console.log('JSON:', data);
      return res;
    },
    setHeader: (k, v) => console.log('HEADER:', k, v)
  } as any;

  try {
    console.log("Calling handler...");
    const { default: handler } = await import('./api/v1/[...route].ts');
    await handler(req, res);
    console.log("Handler finished.");
  } catch(e) {
    console.error("CAUGHT UNHANDLED EXCEPTION:", e);
  }
}
run();

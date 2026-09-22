import { randomBytes, createHash } from 'node:crypto';

const env = process.argv[2] || 'test';
if (env !== 'test' && env !== 'live') {
  console.error('Environment must be "test" or "live"');
  process.exit(1);
}

const key = 'stb_' + env + '_' + randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(key, 'utf8').digest('hex');

console.log(`\n=== Bridge API Key (${env}) ===`);
console.log(`RAW KEY (Give this to the AI Assistant):`);
console.log(key);
console.log(`\nDIGEST (Put this inside the Vercel BRIDGE_KEY_STORE JSON array):`);
console.log(`sha256:${digest}`);
console.log(`==================================\n`);

import { randomBytes } from 'node:crypto';

const env = process.argv[2] || 'test';
if (env !== 'test' && env !== 'live') {
  console.error('Environment must be "test" or "live"');
  process.exit(1);
}

const key = 'stb_' + env + '_' + randomBytes(32).toString('base64url');
console.log(`Generated Bridge API Key (${env}):`);
console.log(key);

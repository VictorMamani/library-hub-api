const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

const path = join(process.cwd(), '.env');
let content = existsSync(path)
  ? readFileSync(path, 'utf8')
  : readFileSync(join(process.cwd(), '.env.example'), 'utf8');
if (/^JWT_SECRET=replace-.*$/m.test(content)) {
  content = content.replace(
    /^JWT_SECRET=replace-.*$/m,
    `JWT_SECRET=${randomBytes(48).toString('base64url')}`,
  );
}
writeFileSync(path, content, { mode: 0o600 });
console.log('Archivo .env de desarrollo preparado.');

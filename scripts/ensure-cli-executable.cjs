const fs = require('fs');

const file = process.argv[2];
if (!file) {
  throw new Error('Usage: node scripts/ensure-cli-executable.cjs <file>');
}

let content = fs.readFileSync(file, 'utf8');
if (!content.startsWith('#!/usr/bin/env node')) {
  content = `#!/usr/bin/env node\n${content}`;
  fs.writeFileSync(file, content);
}
fs.chmodSync(file, 0o755);

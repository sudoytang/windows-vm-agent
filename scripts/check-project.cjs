const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const excluded = new Set(['.git', 'private', 'artifacts', 'node_modules']);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
let failures = 0;
for (const file of walk(root)) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const checks = [
    [/[^\x00-\x7F]/, 'Source and documentation must use English ASCII text.'],
    [/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/, 'Private key material found.'],
    [/gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}/, 'GitHub credential found.'],
    [/["']apiToken["']\s*:\s*["'][a-f0-9]{32,}["']/i, 'A literal API token must not be committed.'],
    [/C:[\\/]+Users[\\/]+lunar\b/i, 'Machine-specific user path found.'],
  ];
  for (const [pattern, message] of checks) if (pattern.test(text)) {
    console.error(`${relative}: ${message}`); failures++;
  }
  if (file.endsWith('.cjs')) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch (error) { console.error(error.stderr.toString()); failures++; }
  }
}
if (failures) process.exitCode = 1;
else console.log('Source syntax, English-only text, and publication hygiene checks passed.');

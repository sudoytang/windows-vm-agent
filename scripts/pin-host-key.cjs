#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { options } = require('./init.cjs');

function pin(o) {
  const directory = path.resolve(o.directory || path.join(__dirname, '..', 'private'));
  const c = JSON.parse(fs.readFileSync(path.join(directory, 'connection.json'), 'utf8'));
  if (!o.file) throw new Error('--file must contain a host public key copied through a trusted channel.');
  const lines = fs.readFileSync(o.file, 'utf8').trim().split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  if (lines.length !== 1) throw new Error('Expected one SSH host public key.');
  const parts = lines[0].trim().split(/\s+/);
  if (parts[0] !== 'ssh-ed25519' || !/^[a-zA-Z0-9+/]+={0,2}$/.test(parts[1] || '')) throw new Error('Expected an Ed25519 public key, not a private key or known_hosts line.');
  const raw = Buffer.from(parts[1], 'base64');
  if (raw.length < 32) throw new Error('Invalid SSH public key.');
  const fingerprint = 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
  if (o.fingerprint && o.fingerprint !== fingerprint) throw new Error('Host key fingerprint mismatch.');
  const target = path.join(directory, 'known_hosts');
  const entry = `${c.guestAddress} ${parts[0]} ${parts[1]}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').trim() && fs.readFileSync(target, 'utf8') !== entry) throw new Error('A different host key is already pinned. Verify any replacement manually.');
  fs.writeFileSync(target, entry, { mode: 0o600 });
  return { pinned: c.guestAddress, fingerprint };
}

if (require.main === module) {
  try { console.log(JSON.stringify(pin(options(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { pin };

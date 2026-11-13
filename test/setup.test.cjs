const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { initialize } = require('../scripts/init.cjs');
const { pin } = require('../scripts/pin-host-key.cjs');

test('initialization rejects unsafe input before generating credentials', () => {
  assert.throws(() => initialize({ address: 'not-an-ip' }), /guest IP/);
  assert.throws(() => initialize({ address: '192.0.2.10', 'host-address': '192.0.2.1', user: 'user\nProxyCommand bad' }), /account name/);
});

test('host key pinning rejects mismatches and silent key replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-agent-pin-'));
  try {
    fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ guestAddress: '192.0.2.10' }));
    const bytes = Buffer.alloc(51, 7);
    const key = 'ssh-ed25519 ' + bytes.toString('base64');
    const file = path.join(dir, 'host.pub');
    fs.writeFileSync(file, key + ' example-host');
    assert.throws(() => pin({ directory: dir, file, fingerprint: 'SHA256:wrong' }), /mismatch/);
    const fingerprint = 'SHA256:' + createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '');
    assert.equal(pin({ directory: dir, file, fingerprint }).fingerprint, fingerprint);
    assert.match(fs.readFileSync(path.join(dir, 'known_hosts'), 'utf8'), /^192\.0\.2\.10 ssh-ed25519 /);
    fs.writeFileSync(file, 'ssh-ed25519 ' + Buffer.alloc(51, 8).toString('base64'));
    assert.throws(() => pin({ directory: dir, file }), /different host key/);
  } finally { for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const core = require('../host/core.cjs');

test('compact trees retain actionable IDs and escape multiline text', () => {
  const output = core.compactTree({ hwnd: 42, snapshot: 's1', nodes: 2, truncated: true, tree: {
    id: 's1:1', role: 'Window', name: 'Editor', enabled: true, children: [
      { id: 's1:2', role: 'Edit', name: 'Body', enabled: true, value: 'line one\n\u4e2d\u6587', actions: ['Value'] },
    ],
  } });
  assert.match(output, /window=42 snapshot=s1 nodes=2 TRUNCATED/);
  assert.match(output, /s1:2 Edit "Body" value="line one\\n/);
  assert.equal(output.split('\n').length, 3);
});

test('external configuration stays relative to its own directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-agent-config-'));
  const previous = process.env.VM_AGENT_CONFIG;
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ apiToken: 'test-only-token-'.repeat(4), localPort: 12001 }));
    process.env.VM_AGENT_CONFIG = file;
    assert.equal(core.config().sshConfig, path.join(dir, 'ssh_config'));
    assert.equal(core.config().localPort, 12001);
    assert.equal(core.config().apiPort, 18765);
    fs.writeFileSync(file, JSON.stringify({ apiToken: 'short', localPort: 70000 }));
    assert.throws(() => core.config(), /Invalid localPort/);
  } finally {
    if (previous === undefined) delete process.env.VM_AGENT_CONFIG; else process.env.VM_AGENT_CONFIG = previous;
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir);
  }
});

test('API transport authenticates requests, preserves binary data, and reports errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-agent-http-'));
  const previous = process.env.VM_AGENT_CONFIG;
  const token = 'test-only-token-'.repeat(4);
  const binary = Buffer.from([137, 80, 78, 71, 0, 255, 1, 2]);
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    if (req.url === '/image') { res.setHeader('Content-Type', 'image/png'); return res.end(binary); }
    if (req.url === '/failure') { res.statusCode = 409; return res.end('stale element'); }
    let body = ''; req.on('data', data => body += data); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const file = path.join(dir, 'connection.json');
    fs.writeFileSync(file, JSON.stringify({ apiToken: token, localPort: server.address().port }));
    process.env.VM_AGENT_CONFIG = file;
    const result = await core.api('/ui/action', { value: '\u4e2d\u6587 : ; "quoted"' });
    assert.equal(result.method, 'POST');
    assert.equal(result.body.value, '\u4e2d\u6587 : ; "quoted"');
    assert.deepEqual(await core.api('/image'), binary);
    await assert.rejects(core.api('/failure'), /Desktop API 409: stale element/);
  } finally {
    if (previous === undefined) delete process.env.VM_AGENT_CONFIG; else process.env.VM_AGENT_CONFIG = previous;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('MCP stdio negotiates, lists tools, and reports protocol errors without stdout noise', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'host', 'mcp.cjs')], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
    { jsonrpc: '2.0', id: 4, method: 'unknown' },
  ];
  child.stdin.end(messages.map(JSON.stringify).join('\n') + '\ninvalid-json\n');
  assert.equal(await done, 0);
  assert.equal(stderr, '');
  const responses = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].result.protocolVersion, '2025-06-18');
  assert.equal(responses[1].result.tools.length, 9);
  assert.equal(new Set(responses[1].result.tools.map(tool => tool.name)).size, 9);
  assert.deepEqual(responses[2].result, {});
  assert.equal(responses[3].error.code, -32601);
  assert.equal(responses[4].error.code, -32700);
});

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function config() {
  const file = path.resolve(process.env.VM_AGENT_CONFIG || path.join(root, 'private', 'connection.json'));
  if (!fs.existsSync(file)) throw new Error('Connection configuration not found. Run node scripts/init.cjs first.');
  const c = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const directory = path.dirname(file);
  for (const key of ['apiPort', 'localPort']) {
    c[key] = c[key] ?? 18765;
    if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > 65535) throw new Error(`Invalid ${key}`);
  }
  if (typeof c.apiToken !== 'string' || c.apiToken.length < 32) throw new Error('A random API token of at least 32 characters is required.');
  c.sshAlias = c.sshAlias || 'vm-agent';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(c.sshAlias)) throw new Error('Invalid SSH alias');
  c.sshPath = c.sshPath || (process.platform === 'win32' ? 'ssh.exe' : 'ssh');
  c.scpPath = c.scpPath || (process.platform === 'win32' ? 'scp.exe' : 'scp');
  c.sshConfig = path.resolve(directory, c.sshConfig || 'ssh_config');
  c.stateDirectory = directory;
  return c;
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ exitCode: error ? error.code : 0, stdout, stderr });
    });
  });
}

async function exec(script, timeout = 60000) {
  if (typeof script !== 'string' || !script.trim()) throw new Error('A PowerShell script is required.');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 300000) throw new Error('timeout must be between 1000 and 300000 milliseconds.');
  const c = config();
  const wrapped = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop';try { & {\n" + script + "\n} } catch { [Console]::Error.WriteLine($_.ToString());exit 1 }";
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  return run(c.sshPath, ['-F', c.sshConfig, c.sshAlias, 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout });
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function tunnel() {
  const c = config();
  if (await portOpen(c.localPort)) return;
  const log = fs.openSync(path.join(c.stateDirectory, 'tunnel.log'), 'a');
  const child = spawn(c.sshPath, [
    '-F', c.sshConfig, '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3', '-L', `127.0.0.1:${c.localPort}:127.0.0.1:${c.apiPort}`, c.sshAlias,
  ], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();
  fs.closeSync(log);
  if (child.pid) fs.writeFileSync(path.join(c.stateDirectory, 'tunnel.json'), JSON.stringify({ pid: child.pid, port: c.localPort }), { mode: 0o600 });
  for (let i = 0; i < 40; i++) {
    if (failure) throw failure;
    if (await portOpen(c.localPort)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`SSH tunnel did not start. Inspect ${path.join(c.stateDirectory, 'tunnel.log')}`);
}

async function api(endpoint, body, query = {}) {
  await tunnel();
  const c = config();
  const url = new URL(`http://127.0.0.1:${c.localPort}${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${c.apiToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Desktop API ${response.status}: ${await response.text()}`);
  if (response.headers.get('content-type')?.startsWith('image/')) return Buffer.from(await response.arrayBuffer());
  return response.json();
}

function compactTree(data) {
  const lines = [`window=${data.hwnd} snapshot=${data.snapshot} nodes=${data.nodes}${data.truncated ? ' TRUNCATED' : ''}`];
  function walk(node, depth) {
    if (!node) return;
    let line = `${'  '.repeat(depth)}${node.id} ${node.role}`;
    if (node.name) line += ` ${JSON.stringify(node.name)}`;
    if (node.automationId) line += ` aid=${JSON.stringify(node.automationId)}`;
    if (node.value !== undefined) line += ` value=${JSON.stringify(node.value)}`;
    else if (node.text) line += ` text=${JSON.stringify(node.text)}`;
    if (!node.enabled) line += ' disabled';
    if (node.password) line += ' password';
    if (node.offscreen) line += ' offscreen';
    if (node.actions?.length) line += ` [${node.actions.join(',')}]`;
    lines.push(line);
    for (const child of node.children || []) walk(child, depth + 1);
  }
  walk(data.tree, 0);
  return lines.join('\n');
}

async function put(local, remote) {
  const c = config();
  return run(c.scpPath, ['-F', c.sshConfig, local, `${c.sshAlias}:${remote.replace(/\\/g, '/')}`], { timeout: 60000 });
}

module.exports = { root, config, exec, tunnel, api, compactTree, put };

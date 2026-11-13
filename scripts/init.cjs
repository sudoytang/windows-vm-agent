#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('Options require a value.');
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}

function initialize(o) {
  if (!o.address || !net.isIP(o.address)) throw new Error('--address must be the guest IP address.');
  if (!o['host-address'] || !net.isIP(o['host-address'])) throw new Error('--host-address must be the host IP visible to the guest.');
  if (!o.user || !/^[a-zA-Z0-9._-]+$/.test(o.user)) throw new Error('--user must be a local Windows account name.');
  const directory = path.resolve(o.directory || path.join(root, 'private'));
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('Refusing to overwrite an existing private directory.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identity = path.join(directory, 'id_ed25519');
  const keygen = process.platform === 'win32' ? 'ssh-keygen.exe' : 'ssh-keygen';
  execFileSync(keygen, ['-t', 'ed25519', '-N', '', '-C', 'windows-vm-agent', '-f', identity], { stdio: 'ignore', windowsHide: true });
  const token = randomBytes(32).toString('hex');
  const localPort = Number(o['local-port'] || 18765);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error('Invalid --local-port');
  const write = (name, data) => fs.writeFileSync(path.join(directory, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  write('connection.json', { guestAddress: o.address, user: o.user, sshAlias: 'vm-agent', sshConfig: 'ssh_config', apiPort: 18765, localPort, apiToken: token });
  write('guest-config.json', { guestAddress: o.address, user: o.user, hostAddress: o['host-address'], publicKey: fs.readFileSync(identity + '.pub', 'utf8').trim(), apiPort: 18765, apiToken: token });
  const quote = value => '"' + value.replace(/\\/g, '/') + '"';
  write('ssh_config', [
    'Host vm-agent', `    HostName ${o.address}`, `    User ${o.user}`, `    IdentityFile ${quote(identity)}`,
    '    IdentitiesOnly yes', '    BatchMode yes', '    StrictHostKeyChecking yes',
    `    UserKnownHostsFile ${quote(path.join(directory, 'known_hosts'))}`, '    ConnectTimeout 8', '    LogLevel ERROR', '',
  ].join('\n'));
  write('known_hosts', '');
  return { directory, next: 'Install the guest, then run scripts/pin-host-key.cjs with its verified host public key.' };
}

if (require.main === module) {
  try { console.log(JSON.stringify(initialize(options(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { initialize, options };

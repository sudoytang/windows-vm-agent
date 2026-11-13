# Windows VM Agent

Control a Windows test VM with SSH commands and structured UI Automation. Use screenshots only when an application does not expose useful controls.

- **SSH:** commands, files, processes, and system management.
- **CLI:** compact window trees, control actions, Unicode input, and native PNG captures.
- **MCP:** an optional stdio adapter sharing the CLI implementation.
- **Guest:** a small C# desktop application using Windows UI Automation.

No npm or NuGet dependencies are required. The guest API binds to `127.0.0.1` and is reached through an authenticated SSH tunnel.

## Requirements

- Host: Node.js 22 or newer, OpenSSH client, and SCP.
- Guest: Windows 10/11, .NET Framework 4.8, and a logged-in local administrator account.
- Building the guest program requires Windows and its .NET Framework C# compiler.

## Setup

### 1. Prepare the host

```powershell
git clone https://github.com/sudoytang/windows-vm-agent.git
cd windows-vm-agent
npm run build:guest
node scripts/init.cjs --address 192.0.2.10 --user vmuser --host-address 192.0.2.1
```

Replace the example IP addresses with the guest IP and the host IP visible to the guest. Initialization creates a dedicated SSH key, random API token, and connection files in the ignored `private/` directory. It refuses to overwrite existing configuration.

### 2. Install inside the guest

Copy `artifacts/DesktopAgent.exe`, `guest/`, and `private/guest-config.json` into a temporary guest folder through a trusted channel such as VMware shared folders. Open an elevated PowerShell in that folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\guest\install-ssh.ps1 -ConfigPath .\guest-config.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\guest\install-desktop.ps1 -ConfigPath .\guest-config.json -AgentPath .\DesktopAgent.exe
```

The SSH installer configures key-only authentication and a host-restricted firewall rule. It requires explicit `-ReplaceSshConfig` before replacing an existing unmanaged SSH configuration and keeps a backup. Other existing firewall rules are not audited automatically. Use a dedicated test VM.

If Windows optional-feature installation is unavailable, install Microsoft's [Win32-OpenSSH](https://github.com/PowerShell/Win32-OpenSSH) first, or pass a downloaded official ZIP using `-OpenSshArchive` and its verified `-ArchiveSha256`.

### 3. Pin the host key

The installer writes `guest-host-key.pub` next to the guest configuration and prints its fingerprint. Copy that public key back through a trusted channel:

```powershell
node scripts/pin-host-key.cjs --file .\guest-host-key.pub
.\vm.ps1 health
```

Host key checking stays enabled. Do not obtain the key from an unverified network scan.

## CLI

```powershell
Set-Alias vm .\vm.ps1
vm exec 'Get-Process | Select-Object -First 5 Name,Id'
vm launch notepad.exe
vm windows
vm tree --depth 4 --max-nodes 80
```

A tree contains actionable IDs rather than pixels:

```text
window=42 snapshot=s1 nodes=2
s1:1 Window "Untitled - Notepad"
  s1:2 Document "Text editor" value="" [Value,Text]
```

```powershell
vm action s1:2 setValue --value 'Hello from the agent'
vm action s1:2 focus
vm key CTRL+S
vm tree
vm screenshot --output guest.png
vm screenshot --x 0 --y 0 --width 500 --height 300 --output crop.png
vm put local.txt C:/Users/vmuser/Documents/local.txt
```

Use IDs from the actual latest tree. Another tree request or two minutes of elapsed time expires them. Keep GUI calls sequential. Some forms need `focus`, `CTRL+A`, `type`, then `TAB` or `ENTER` to commit a value. Use `CTRL+SHIFT+S` explicitly for Save As.

`vm help` lists all commands. Set `VM_AGENT_CONFIG` to use a connection file outside the default `private/connection.json`; relative SSH configuration paths are resolved next to that file. An existing deployment can be reused without copying credentials into this repository.

## MCP

Copy and adjust [examples/mcp.json](examples/mcp.json) in a compatible client. The adapter exposes `vm_exec`, `vm_health`, `vm_windows`, `vm_tree`, `vm_action`, `vm_focus`, `vm_launch`, `vm_input`, and `vm_screenshot`.

Only the screenshot tool returns image content. Other tools return text. The CLI is useful when tool-schema overhead matters.

## Operating model

The `VmAgent-Desktop` scheduled task starts `DesktopAgent.exe` in the user's interactive session at logon. SSH commands run in a separate noninteractive session; use `vm launch` for visible applications. The VM must remain logged in and unlocked.

UAC secure-desktop prompts and the sign-in screen need the VMware console or another external console. Games, canvases, and some custom controls may require pixel input. UAC and antivirus settings are not disabled by this project.

This is a trusted-agent tool, not a multi-user isolation boundary: an authorized client can act with the guest user's administrator privileges. Keep `private/` private, trust the host running the CLI, and do not expose the HTTP API publicly.

## Development

```powershell
npm run check
npm test
npm run build:guest
```

Tests cover configuration handling, host-key pinning, HTTP transport, and MCP stdio. A Windows VM integration run also exercised control reads/writes, Unicode typing, GUI Save As with SSH file readback, screenshots, authentication rejection, and reboot recovery. A VM is not required for unit tests.

## License

[Unlicense](LICENSE). Windows and OpenSSH remain subject to their own licenses; their binaries are not included.

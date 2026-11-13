[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [switch]$ReplaceSshConfig,
    [string]$OpenSshArchive,
    [string]$ArchiveSha256
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$cfg=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
if(-not$cfg.user-or-not$cfg.hostAddress-or-not$cfg.publicKey){throw 'The configuration must contain user, hostAddress, and publicKey.'}
if($cfg.user-notmatch'^[a-zA-Z0-9._-]+$'){throw 'Only a local Windows account is supported.'}
$ip=$null
if(-not[Net.IPAddress]::TryParse([string]$cfg.hostAddress,[ref]$ip)){throw 'hostAddress must be one host IP address.'}
if($cfg.publicKey-notmatch'^ssh-ed25519 [a-zA-Z0-9+/=]+(?: .*)?$'){throw 'An Ed25519 public key is required.'}
$principal=New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this script as an administrator inside the dedicated test VM.'}
$localUser=Get-LocalUser -Name $cfg.user
$admins=Get-LocalGroupMember -SID 'S-1-5-32-544'
if(-not($admins|Where-Object{$_.SID.Value-eq$localUser.SID.Value})){throw 'This installer requires the target user to be an existing local administrator.'}
$sshDir=Join-Path $env:ProgramData 'ssh'
$configFile=Join-Path $sshDir 'sshd_config'
$marker='# Managed by windows-vm-agent'
if((Test-Path $configFile)-and((Get-Content $configFile -Raw)-notmatch[regex]::Escape($marker))-and-not$ReplaceSshConfig){throw 'An existing SSH configuration was found. Review it and pass -ReplaceSshConfig to replace it with a backup.'}
if(-not$PSCmdlet.ShouldProcess('This dedicated test VM','Install/configure key-only SSH and restrict its built-in firewall allowance to the specified host')){return}

$service=Get-CimInstance Win32_Service -Filter "Name='sshd'"
if(-not$service){
    if($OpenSshArchive){
        if($ArchiveSha256-notmatch'^[a-fA-F0-9]{64}$'){throw '-ArchiveSha256 is required with -OpenSshArchive.'}
        if((Get-FileHash -LiteralPath $OpenSshArchive -Algorithm SHA256).Hash-ne$ArchiveSha256){throw 'OpenSSH archive checksum mismatch.'}
        $temp=Join-Path $env:TEMP ('vm-agent-ssh-'+[guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $OpenSshArchive -DestinationPath $temp
        $package=Join-Path $temp 'OpenSSH-Win64'
        if(-not(Test-Path "$package\install-sshd.ps1")){throw 'Expected the official OpenSSH-Win64 package layout.'}
        $bin=Join-Path $env:ProgramFiles 'OpenSSH'
        New-Item -ItemType Directory -Path $bin -Force|Out-Null
        Copy-Item "$package\*" $bin -Recurse -Force
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$bin\install-sshd.ps1"
        if($LASTEXITCODE-ne0){throw 'OpenSSH package installation failed.'}
    }else{
        $cap=Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
        if($cap.State-ne'Installed'){Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'|Out-Null}
    }
    $service=Get-CimInstance Win32_Service -Filter "Name='sshd'"
}
if(-not$service){throw 'The SSH service was not installed.'}
$exe=if($service.PathName.StartsWith('"')){($service.PathName-split'"')[1]}else{($service.PathName-split' ')[0]}
$bin=Split-Path $exe
if(-not(Test-Path "$bin\ssh-keygen.exe")){throw 'The SSH service binary directory is not valid.'}
New-Item -ItemType Directory -Path $sshDir -Force|Out-Null
if(Test-Path $configFile){Copy-Item $configFile ($configFile+'.backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
@"
$marker
Port 22
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AllowUsers $($cfg.user.ToLowerInvariant())
AuthorizedKeysFile .ssh/authorized_keys
Subsystem sftp internal-sftp
Match Group administrators
    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
"@|Set-Content $configFile -Encoding ascii

function Set-PrivateFileAcl([string]$Path){
    $acl=New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))
    foreach($sid in @('S-1-5-18','S-1-5-32-544')){
        $rule=New-Object Security.AccessControl.FileSystemAccessRule ((New-Object Security.Principal.SecurityIdentifier $sid)),([Security.AccessControl.FileSystemRights]::FullControl),([Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
$authorizedKeys=Join-Path $sshDir 'administrators_authorized_keys'
$existing=@();if(Test-Path $authorizedKeys){$existing=@(Get-Content $authorizedKeys)}
if($existing-notcontains$cfg.publicKey){Add-Content $authorizedKeys $cfg.publicKey -Encoding ascii}
Set-PrivateFileAcl $authorizedKeys
& "$bin\ssh-keygen.exe" -A
if($LASTEXITCODE-ne0){throw 'Host key generation failed.'}
Get-ChildItem "$sshDir\ssh_host_*_key" -File|ForEach-Object{Set-PrivateFileAcl $_.FullName}
& $exe -t
if($LASTEXITCODE-ne0){throw 'SSH configuration validation failed.'}
Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue|Disable-NetFirewallRule
Get-NetFirewallRule -Name VmAgent-SSH-Host -ErrorAction SilentlyContinue|Remove-NetFirewallRule
New-NetFirewallRule -Name VmAgent-SSH-Host -DisplayName 'Windows VM Agent SSH from host' -Direction Inbound -Protocol TCP -LocalPort 22 -RemoteAddress $cfg.hostAddress -Action Allow -Profile Any|Out-Null
if(-not(Test-Path HKLM:\SOFTWARE\OpenSSH)){New-Item HKLM:\SOFTWARE\OpenSSH|Out-Null}
New-ItemProperty HKLM:\SOFTWARE\OpenSSH -Name DefaultShell -Value "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force|Out-Null
Set-Service sshd -StartupType Automatic
Restart-Service sshd
$publicKey=Join-Path $sshDir 'ssh_host_ed25519_key.pub'
Copy-Item $publicKey (Join-Path (Split-Path (Resolve-Path $ConfigPath).Path) 'guest-host-key.pub') -Force
& "$bin\ssh-keygen.exe" -lf $publicKey
Write-Output 'SSH is ready. Copy guest-host-key.pub back to the host through a trusted channel, then pin it.'

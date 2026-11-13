param(
    [string]$Root='C:\ProgramData\VmAgent',
    [string]$User,
    [string]$ConfigPath,
    [string]$AgentPath
)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $Root -Force|Out-Null
if($ConfigPath){Copy-Item -LiteralPath $ConfigPath -Destination "$Root\config.json" -Force}
if($AgentPath){Copy-Item -LiteralPath $AgentPath -Destination "$Root\DesktopAgent.exe" -Force}
$cfg=Get-Content "$Root\config.json" -Raw|ConvertFrom-Json
if(-not$User){$User=if($cfg.user){$cfg.user}else{$env:USERNAME}}
if(-not$cfg.apiToken-or$cfg.apiToken.Length-lt32){throw 'API token missing'}
if(-not(Test-Path "$Root\DesktopAgent.exe")){throw 'DesktopAgent.exe missing'}
$taskUser="$env:COMPUTERNAME\$User"
$existing=Get-ScheduledTask -TaskName VmAgent-Desktop -ErrorAction SilentlyContinue
if($existing){Stop-ScheduledTask -TaskName VmAgent-Desktop -ErrorAction SilentlyContinue}
$action=New-ScheduledTaskAction -Execute "$Root\DesktopAgent.exe" -WorkingDirectory $Root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal=New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$task=New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Authenticated localhost UI Automation desktop application; accessed through SSH forwarding.'
Register-ScheduledTask -TaskName VmAgent-Desktop -InputObject $task -Force|Out-Null
Start-ScheduledTask -TaskName VmAgent-Desktop
Write-Output 'Native desktop bridge task installed and started.'

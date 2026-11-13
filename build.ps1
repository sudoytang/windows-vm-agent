$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$framework="$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$out=Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $out -Force|Out-Null
$refs=@('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','WPF\WindowsBase.dll','WPF\UIAutomationClient.dll','WPF\UIAutomationTypes.dll')
$compileArgs=@('/nologo','/target:winexe','/platform:x64',('/out:'+(Join-Path $out 'DesktopAgent.exe')))
foreach($ref in $refs){$compileArgs+='/reference:'+(Join-Path $framework $ref)}
$compileArgs+=(Join-Path $root 'guest\NativeInput.cs')
$compileArgs+=(Join-Path $root 'guest\DesktopAgent.cs')
& "$framework\csc.exe" @compileArgs
if($LASTEXITCODE-ne0){throw 'Desktop agent compilation failed'}
Get-Item (Join-Path $out 'DesktopAgent.exe')|Select-Object FullName,Length

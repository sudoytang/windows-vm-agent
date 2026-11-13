$node=(Get-Command node.exe -ErrorAction Stop).Source
& $node "$PSScriptRoot\host\cli.cjs" @args
exit $LASTEXITCODE

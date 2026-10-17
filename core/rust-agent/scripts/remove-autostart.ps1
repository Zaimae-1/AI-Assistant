$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:APPDATA 'Jarvis\agent.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw 'Agent config is missing.'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.device_id -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'Agent config has an invalid device ID.'
}
$taskName = "JarvisLocalAgent-$($config.device_id)"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output "Autostart removed: $taskName"

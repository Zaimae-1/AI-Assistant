param(
  [Parameter(Mandatory = $true)]
  [string]$AgentExe
)

$ErrorActionPreference = 'Stop'
$resolvedAgent = (Resolve-Path -LiteralPath $AgentExe).Path
if ([IO.Path]::GetExtension($resolvedAgent) -ne '.exe') {
  throw 'AgentExe must be a built .exe file.'
}

$configPath = Join-Path $env:APPDATA 'Jarvis\agent.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw 'Agent is not enrolled. Run jarvis-core enroll first.'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.device_id -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'Agent config has an invalid device ID.'
}

$taskName = "JarvisLocalAgent-$($config.device_id)"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $resolvedAgent -Argument 'run'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Autostart registered for this Windows user: $taskName"

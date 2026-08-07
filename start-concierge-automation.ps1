# Runs the serverless concierge verification suite. It starts no web server,
# n8n process, or background daemon on this computer.

$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $automationRoot '.env'
$workerRoot = Join-Path $automationRoot 'cloudflare-worker'

if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim("'", '"')
            if ($name -and $value -and $value -notmatch '^(your_|YOUR_|replace-with)') {
                [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            }
        }
    }
}

Push-Location $workerRoot
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Worker unit tests failed.' }
    npm run test:live
    if ($LASTEXITCODE -ne 0) { throw 'Worker live smoke test failed.' }
} finally {
    Pop-Location
}

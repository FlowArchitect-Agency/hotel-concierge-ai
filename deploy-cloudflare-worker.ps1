# Deploy the code-native concierge without n8n Cloud.
# The script loads private values from the ignored .env file and never prints them.

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $projectRoot '.env'
$workerRoot = Join-Path $projectRoot 'cloudflare-worker'

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

if (-not $env:CLOUDFLARE_API_TOKEN) {
    throw 'CLOUDFLARE_API_TOKEN is required in the private .env file.'
}

Push-Location $workerRoot
try {
    & npx --yes wrangler deploy
    if ($LASTEXITCODE -ne 0) { throw 'Worker deployment failed.' }

    foreach ($secretName in @('GROQ_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'SCRAPINGBEE_API_KEY')) {
        $secretValue = [Environment]::GetEnvironmentVariable($secretName, 'Process')
        if (-not $secretValue) {
            if ($secretName -eq 'SCRAPINGBEE_API_KEY') { continue }
            throw "$secretName is required in the private .env file."
        }
        $secretValue | & npx --yes wrangler secret put $secretName --name conciergeflow-api
        if ($LASTEXITCODE -ne 0) { throw "Could not configure $secretName." }
    }
} finally {
    Pop-Location
}

# start-n8n.ps1 - Run this to start n8n with correct environment variables
# Usage: .\start-n8n.ps1

# Load .env from project folder
$envFile = "C:\Users\ALEM\Documents\Codex\2026-07-27\act-as-a-senior-full-stack\outputs\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            if ($name -and $value -notmatch '^your_|^YOUR_') {
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
                Write-Host "Loaded: $name"
            }
        }
    }
} else {
    Write-Warning ".env not found at $envFile"
}

# Verify critical vars
Write-Host "AIRTABLE_BASE_ID configured: $([bool]$env:AIRTABLE_BASE_ID)"
Write-Host "AIRTABLE_API_KEY configured: $([bool]$env:AIRTABLE_API_KEY)"
Write-Host "N8N_BLOCK_ENV_ACCESS_IN_NODE configured: $([bool]$env:N8N_BLOCK_ENV_ACCESS_IN_NODE)"

# Kill any existing n8n on port 5678
try {
    $proc = Get-Process -Name "n8n" -ErrorAction SilentlyContinue
    if ($proc) { Stop-Process -Id $proc.Id -Force; Write-Host "Stopped existing n8n process" }
} catch {}

# Start n8n
Write-Host "Starting n8n..."
n8n start

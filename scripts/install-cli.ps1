# Tale CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "tale-project/tale"
$BinaryName = "tale.exe"
$InstallDir = "$env:LOCALAPPDATA\Programs\tale"

function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Err { param($msg) Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

function Format-FileSize {
    param([long]$bytes)
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

# Detect existing installation
$existing = Get-Command tale -ErrorAction SilentlyContinue
if ($existing) {
    $existingDir = Split-Path $existing.Source
    Write-Info "Found existing installation at $existingDir"
    $InstallDir = $existingDir
}

# Fetch latest release tag
Write-Info "Fetching latest version..."
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$tag = $release.tag_name
Write-Info "Latest version: $tag"

# Download binary
$url = "https://github.com/$Repo/releases/download/$tag/tale_windows.exe"
$tempFile = Join-Path $env:TEMP "tale_download_$([guid]::NewGuid()).exe"

try {
    Write-Info "Downloading from $url"
    $ProgressPreference = 'SilentlyContinue'
    $webClient = New-Object System.Net.WebClient
    $null = Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action {
        $received = Format-FileSize $EventArgs.BytesReceived
        $total = Format-FileSize $EventArgs.TotalBytesToReceive
        $pct = $EventArgs.ProgressPercentage
        Write-Host "`r  $received / $total ($pct%)" -NoNewline -ForegroundColor Cyan
    }
    $webClient.DownloadFileTaskAsync($url, $tempFile).GetAwaiter().GetResult()
    Write-Host ""
    $webClient.Dispose()
} catch {
    Write-Err "Failed to download: $_"
}

# Ensure install directory exists
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Move binary to install directory
$dest = Join-Path $InstallDir $BinaryName
Move-Item -Path $tempFile -Destination $dest -Force

# Add to user PATH if not already present
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
    $newPath = "$userPath;$InstallDir"
    if ($newPath.Length -gt 8192) {
        Write-Err "User PATH would exceed 8192 characters. Manually add $InstallDir to your PATH."
    }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Info "Added $InstallDir to user PATH."
}

# Verify
try {
    $version = & $dest --version 2>&1
    Write-Ok "Tale CLI installed successfully! ($version)"
} catch {
    Write-Ok "Tale CLI installed to $dest"
}

Write-Ok "Run 'tale --help' to get started."
if (-not $existing) {
    Write-Info "Restart your terminal for PATH changes to take effect."
}

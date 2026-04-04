# Tale CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "tale-project/tale"
$BinaryName = "tale.exe"
$InstallDir = "$env:LOCALAPPDATA\Programs\tale"

function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Err { param($msg) Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

# Detect existing installation
$existing = Get-Command tale -ErrorAction SilentlyContinue
if ($existing) {
    $existingDir = Split-Path $existing.Source
    Write-Info "Found existing installation at $existingDir"
    $InstallDir = $existingDir
}

# Fetch latest release tag
Write-Info "Fetching latest version..."
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "tale-installer/1.0" }
} catch {
    Write-Err "Failed to fetch latest release. $_"
}
$tag = $release.tag_name
Write-Info "Latest version: $tag"

# Download binary
$url = "https://github.com/$Repo/releases/download/$tag/tale_windows.exe"
$tempFile = Join-Path $env:TEMP "tale_download_$([guid]::NewGuid()).tmp"

function Format-FileSize {
    param([long]$bytes)
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

$httpClient = $null
$response = $null
$stream = $null
$fileStream = $null
try {
    Write-Info "Downloading from $url"
    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $httpClient = New-Object System.Net.Http.HttpClient
    $httpClient.DefaultRequestHeaders.Add("User-Agent", "tale-installer/1.0")
    $httpClient.Timeout = [timespan]::FromMinutes(10)
    $response = $httpClient.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    [void]$response.EnsureSuccessStatusCode()

    $totalBytes = $response.Content.Headers.ContentLength
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $fileStream = [System.IO.File]::Create($tempFile)

    $buffer = [byte[]]::new(65536)
    $totalRead = [long]0
    $lastUpdate = [datetime]::MinValue
    $bytesRead = 0

    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $bytesRead)
        $totalRead += $bytesRead
        $now = [datetime]::UtcNow
        if (($now - $lastUpdate).TotalMilliseconds -ge 250) {
            $lastUpdate = $now
            $received = Format-FileSize $totalRead
            if ($totalBytes) {
                $total = Format-FileSize $totalBytes
                $pct = [math]::Floor($totalRead * 100 / $totalBytes)
                Write-Host ("`r  {0} / {1} ({2}%)   " -f $received, $total, $pct) -NoNewline -ForegroundColor Cyan
            } else {
                Write-Host ("`r  {0} downloaded   " -f $received) -NoNewline -ForegroundColor Cyan
            }
        }
    }

    # Validate download integrity
    if ($totalBytes -and $totalRead -ne $totalBytes) {
        throw "Download incomplete: received $(Format-FileSize $totalRead) of $(Format-FileSize $totalBytes)"
    }
    if ($totalRead -eq 0) {
        throw "Download failed: received 0 bytes"
    }

    # Final progress line
    $received = Format-FileSize $totalRead
    if ($totalBytes) {
        $total = Format-FileSize $totalBytes
        Write-Host ("`r  {0} / {1} (100%)   " -f $received, $total) -NoNewline -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Ok "Download complete"
    $downloadOk = $true
} catch {
    $errMsg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { "$_" }
    Write-Err "Failed to download: $errMsg"
} finally {
    if ($null -ne $fileStream) { $fileStream.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $httpClient) { $httpClient.Dispose() }
    if (-not $downloadOk -and (Test-Path $tempFile)) {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
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

# Tale CLI installer for Windows.
#
# Usage:           irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
# Pin a version:   $env:VERSION = '0.9.0'; irm ... | iex
#
# Mirrors scripts/install-cli.sh (the Linux/macOS installer) function for
# function and message for message — keep them in sync when changing either.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "tale-project/tale"
$BinaryName = "tale.exe"
$Platform = "windows"
$DefaultInstallDir = "$env:LOCALAPPDATA\Programs\tale"
$RequestedVersion = $env:VERSION

# Colored log helpers — info=cyan, success=green, error=red (then exit 1).
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Err { param($msg) Write-Host "Error: $msg" -ForegroundColor Red; exit 1 }

# Format a byte count for the download progress display. (PowerShell-specific —
# the bash script lets curl --progress-bar handle this.)
function Format-FileSize {
    param([long]$bytes)
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

# Stream a URL to a file with a visible progress bar, then announce completion.
# ResponseHeadersRead avoids buffering the whole body in memory and lets us
# track progress as bytes flow in.
function Download-File {
    param($url, $dest)
    Write-Info "Downloading from $url"

    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $httpClient = New-Object System.Net.Http.HttpClient
    $httpClient.DefaultRequestHeaders.Add("User-Agent", "tale-installer/1.0")
    $httpClient.Timeout = [timespan]::FromMinutes(10)

    $response = $null
    $stream = $null
    $fileStream = $null
    $downloadOk = $false
    try {
        $response = $httpClient.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            [void]$response.EnsureSuccessStatusCode()
        }

        $totalBytes = $response.Content.Headers.ContentLength
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $fileStream = [System.IO.File]::Create($dest)

        $buffer = [byte[]]::new(65536)
        $totalRead = [long]0
        $lastUpdate = [datetime]::MinValue
        $bytesRead = 0

        while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $fileStream.Write($buffer, 0, $bytesRead)
            $totalRead += $bytesRead
            # Throttle redraws to ~4 fps so the spinner doesn't flood the terminal.
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

        # Validate download integrity before we hand the file to install_binary.
        if ($totalBytes -and $totalRead -ne $totalBytes) {
            throw "Download incomplete: received $(Format-FileSize $totalRead) of $(Format-FileSize $totalBytes)"
        }
        if ($totalRead -eq 0) {
            throw "Download failed: received 0 bytes"
        }

        # Snap the progress line to 100% so it doesn't end mid-update.
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
        if (-not $downloadOk -and (Test-Path $dest)) {
            Remove-Item $dest -Force -ErrorAction SilentlyContinue
        }
    }
}

# Find the first release whose assets include our platform binary.
function Get-LatestTag {
    $assetName = "tale_${Platform}.exe"
    try {
        $releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Headers @{ "User-Agent" = "tale-installer/1.0" }
    } catch {
        Write-Err "Failed to fetch releases. $_"
    }
    foreach ($rel in $releases) {
        if ($rel.assets.name -contains $assetName) {
            return $rel.tag_name
        }
    }
    Write-Err "No release found with $assetName binary"
}

# Pick the install directory. If `tale` is already on PATH, replace it in
# place; otherwise default to %LOCALAPPDATA%\Programs\tale. Sets $script:InstallDir
# and $script:ExistingTale for later consumers.
function Detect-InstallDir {
    $script:ExistingTale = Get-Command tale -ErrorAction SilentlyContinue
    if ($script:ExistingTale) {
        $script:InstallDir = Split-Path $script:ExistingTale.Source
        Write-Info "Found existing installation at $script:InstallDir"
    } else {
        $script:InstallDir = $DefaultInstallDir
    }
}

# Decide which tag to install: $env:VERSION (with optional "v" prefix) when
# set, otherwise the result of Get-LatestTag.
function Resolve-Tag {
    if (-not $RequestedVersion) {
        return Get-LatestTag
    }
    # Accept "v0.9.0" or "0.9.0" — release tags are prefixed with "v".
    if ($RequestedVersion.StartsWith("v")) { return $RequestedVersion }
    return "v$RequestedVersion"
}

# Pre-flight HEAD probe. Fails fast with a friendly message when the user
# pinned a non-existent VERSION, instead of letting the binary download error
# out halfway through.
function Verify-ReleaseExists {
    param($url)
    try {
        Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -MaximumRedirection 5 `
            -Headers @{ "User-Agent" = "tale-installer/1.0" } -ErrorAction Stop | Out-Null
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        if ($statusCode -eq 404) {
            Write-Err "Version $RequestedVersion not found. See https://github.com/$Repo/releases for available versions."
        }
        # Other transient errors will surface during the actual download.
    }
}

# Orchestrate: resolve tag → verify (when pinned) → download → move into
# place → ensure the install directory is on the user PATH.
function Install-Binary {
    $tag = Resolve-Tag
    if ($RequestedVersion) {
        Write-Info "Pinned version: $tag"
    } else {
        Write-Info "Latest version: $tag"
    }

    $binaryUrl = "https://github.com/$Repo/releases/download/$tag/tale_${Platform}.exe"
    $tmpFile = Join-Path $env:TEMP "tale_download_$([guid]::NewGuid()).tmp"

    if ($RequestedVersion) { Verify-ReleaseExists $binaryUrl }

    Download-File $binaryUrl $tmpFile

    if (-not (Test-Path $script:InstallDir)) {
        New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
    }
    $script:DestPath = Join-Path $script:InstallDir $BinaryName
    Move-Item -Path $tmpFile -Destination $script:DestPath -Force

    # Add the install directory to the user PATH so `tale` resolves in new shells.
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$script:InstallDir*") {
        $newPath = "$userPath;$script:InstallDir"
        # Windows truncates user PATH at 8192 chars; refuse to silently corrupt it.
        if ($newPath.Length -gt 8192) {
            Write-Err "User PATH would exceed 8192 characters. Manually add $script:InstallDir to your PATH."
        }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$script:InstallDir"
        Write-Info "Added $script:InstallDir to user PATH."
    }
}

# Smoke-test the freshly installed binary by running --version. The version
# string is folded into the success message when available.
function Verify-Installation {
    if (-not (Test-Path $script:DestPath)) {
        Write-Err "Installation failed. tale not found at $script:DestPath"
    }
    try {
        $version = & $script:DestPath --version 2>&1
        Write-Ok "Successfully installed tale ($version)"
    } catch {
        Write-Ok "Successfully installed tale"
    }
}

function Main {
    Write-Info "Installing Tale CLI..."
    Write-Info "Detected platform: $Platform"

    Detect-InstallDir
    Install-Binary
    Verify-Installation

    Write-Ok "Run 'tale --help' to get started."
    if (-not $script:ExistingTale) {
        Write-Info "Restart your terminal for PATH changes to take effect."
    }
}

Main

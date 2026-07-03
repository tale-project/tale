# Tale CLI installer for Windows.
#
# Usage:           irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
# Pin a version:   $env:VERSION = '0.9.0'; irm ... | iex
# Install dir:     $env:INSTALL_DIR = 'C:\Tools\tale'; irm ... | iex
#
# $env:GITHUB_TOKEN, when set, authenticates the GitHub API lookup of the
# latest release — useful in CI, where the anonymous rate limit is easily
# exhausted.
#
# Releases ship a single x64 Windows binary; Windows-on-ARM machines run it
# through the built-in x64 emulation, so there is no arm64 asset to pick.
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

# Verify the downloaded binary against the release's SHA256SUMS file. Releases
# that predate checksum publishing won't have one — warn and continue rather
# than hard-fail, so the installer keeps working against older tags.
function Verify-Checksum {
    param($file, $tag)
    $asset = "tale_${Platform}.exe"
    $sumsUrl = "https://github.com/$Repo/releases/download/$tag/tale_checksums.txt"
    try {
        $sums = (Invoke-WebRequest -Uri $sumsUrl -UseBasicParsing `
            -Headers @{ "User-Agent" = "tale-installer/1.0" } -ErrorAction Stop).Content
    } catch {
        # Only a missing checksum file (404) is a legitimate skip — older
        # releases predate checksum publishing. Any other failure (network,
        # proxy, 5xx) must abort rather than silently install an unverified
        # binary.
        $statusCode = $null
        if ($_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode }
            catch { $statusCode = $null }
        }
        if ($statusCode -eq 404) {
            Write-Info "No checksum file published for $tag; skipping verification."
            return
        }
        $detail = if ($statusCode) { "HTTP $statusCode" } else { "network error" }
        Write-Err "Could not fetch the checksum file for $tag ($detail). Aborting rather than installing an unverified binary."
    }
    $expected = $null
    foreach ($line in ($sums -split "`n")) {
        $parts = ($line.Trim() -split "\s+")
        if ($parts.Length -ge 2 -and $parts[1] -eq $asset) { $expected = $parts[0]; break }
    }
    if (-not $expected) {
        Write-Info "No checksum entry for $asset; skipping verification."
        return
    }
    $actual = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) {
        Write-Err "Checksum mismatch for $asset (expected $expected, got $actual). Aborting."
    }
    Write-Ok "Checksum verified"
}

# Resolve the latest release tag from the releases/latest redirect. Consumes
# no API quota, but cannot check assets — used only as the fallback when the
# GitHub API is rate limited or unreachable. Returns the tag, or $null.
function Get-LatestTagFromRedirect {
    $location = $null
    try {
        # Some hosts hand back the 3xx response, others throw on it — read
        # the Location header from whichever object carries it. The header
        # shape also differs (dictionary vs. typed headers), so try the
        # property first and the indexer second.
        $response = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -Method Head `
            -UseBasicParsing -MaximumRedirection 0 -Headers @{ "User-Agent" = "tale-installer/1.0" } `
            -ErrorAction Stop
        $location = $response.Headers.Location
        if (-not $location) { $location = $response.Headers["Location"] }
    } catch {
        $errResponse = $_.Exception.Response
        if ($errResponse) {
            try {
                $location = $errResponse.Headers.Location
                if (-not $location) { $location = $errResponse.Headers["Location"] }
            } catch { $location = $null }
        }
    }
    if (-not $location) { return $null }
    $tag = ([string]$location).TrimEnd('/').Split('/')[-1]
    if ($tag -and $tag -ne 'latest') { return $tag }
    return $null
}

# Find the first release whose assets include our platform binary. Sends
# `Authorization: Bearer $env:GITHUB_TOKEN` when the env var is set; on a
# rate-limited (403/429) or empty API response, falls back to the
# releases/latest redirect before erroring.
function Get-LatestTag {
    $assetName = "tale_${Platform}.exe"
    $headers = @{ "User-Agent" = "tale-installer/1.0" }
    if ($env:GITHUB_TOKEN) {
        $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
    }
    $releases = $null
    try {
        $releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Headers $headers
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode }
            catch { $statusCode = $null }
        }
        if ($statusCode -eq 403 -or $statusCode -eq 429 -or -not $statusCode) {
            $tag = Get-LatestTagFromRedirect
            if ($tag) { return $tag }
        }
        Write-Err "Failed to fetch releases. $_"
    }
    if (-not $releases) {
        $tag = Get-LatestTagFromRedirect
        if ($tag) { return $tag }
        Write-Err "Failed to fetch releases."
    }
    foreach ($rel in $releases) {
        if ($rel.assets.name -contains $assetName) {
            return $rel.tag_name
        }
    }
    Write-Err "No release found with $assetName binary"
}

# Pick the install directory. An $env:INSTALL_DIR override wins outright;
# otherwise, if `tale` is already on PATH, replace it in place, and default
# to %LOCALAPPDATA%\Programs\tale when neither applies. Sets $script:InstallDir
# and $script:ExistingTale for later consumers.
function Detect-InstallDir {
    if ($env:INSTALL_DIR) {
        $script:ExistingTale = $null
        $script:InstallDir = $env:INSTALL_DIR
        Write-Info "Using install directory from INSTALL_DIR: $script:InstallDir"
        return
    }

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
    Verify-Checksum $tmpFile $tag

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

# Smoke-test the freshly installed binary by running --version. A binary that
# cannot execute (corrupt download, blocked by policy) must fail the install
# here — reporting success for a dead binary strands the user at the very
# next command with no explanation.
function Verify-Installation {
    if (-not (Test-Path $script:DestPath)) {
        Write-Err "Installation failed. tale not found at $script:DestPath"
    }
    try {
        $version = & $script:DestPath --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $version) {
            Write-Ok "Successfully installed tale ($version)"
            return
        }
    } catch {
        # fall through to the failure report below
    }
    Write-Info "The installed binary did not run. Common causes:"
    Write-Info "  - A corrupt download: re-run this installer to fetch it again."
    Write-Info "  - Antivirus or an execution policy blocking $script:DestPath."
    Write-Err "Installation failed. 'tale --version' did not succeed."
}

function Main {
    Write-Info "Installing Tale CLI..."
    Write-Info "Detected platform: $Platform"

    Detect-InstallDir
    Install-Binary
    Verify-Installation

    if (-not $script:ExistingTale) {
        Write-Info "Restart your terminal for PATH changes to take effect."
    }
    # Hand off to the CLI: `tale init` scaffolds a project (no prerequisites);
    # `tale dev` then installs/starts Docker on demand and launches locally.
    Write-Ok "Next: run 'tale init' to create your project, then 'tale dev' to launch it."
}

Main

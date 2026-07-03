#!/bin/bash
# Tale CLI installer for Linux and macOS.
#
# Usage:           curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
# Pin a version:   VERSION=0.9.0 curl -fsSL ... | bash
# Install dir:     INSTALL_DIR=~/.local/bin curl -fsSL ... | bash
#
# GITHUB_TOKEN, when set, authenticates the GitHub API lookup of the latest
# release — useful in CI, where the anonymous rate limit is easily exhausted.
#
# Mirrors scripts/install-cli.ps1 (the Windows installer) function for function
# and message for message — keep them in sync when changing either.

set -euo pipefail

REPO="tale-project/tale"
BINARY_NAME="tale"
DEFAULT_INSTALL_DIR="/usr/local/bin"

# Colored log helpers — info=cyan, success=green, error=red (then exit 1).
info() { printf "\033[1;36m%s\033[0m\n" "$1"; }
success() { printf "\033[1;32m%s\033[0m\n" "$1"; }
error() { printf "\033[1;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

# Map `uname -s` + `uname -m` to the release asset for this machine. Releases
# ship four Unix binaries — tale_macos (arm64), tale_macos_x64, tale_linux
# (x86_64), tale_linux_arm64 — so anything else gets a build-from-source
# pointer up front instead of a cryptic kernel exec error later.
# Sets the $PLATFORM and $ASSET_NAME globals.
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        linux*)  PLATFORM="linux" ;;
        darwin*) PLATFORM="macos" ;;
        *)       error "Unsupported OS: $os" ;;
    esac

    case "$PLATFORM-$arch" in
        macos-arm64)                 ASSET_NAME="${BINARY_NAME}_macos" ;;
        macos-x86_64)                ASSET_NAME="${BINARY_NAME}_macos_x64" ;;
        linux-x86_64 | linux-amd64)  ASSET_NAME="${BINARY_NAME}_linux" ;;
        linux-aarch64 | linux-arm64) ASSET_NAME="${BINARY_NAME}_linux_arm64" ;;
        *) error "No released binary for ${PLATFORM}/${arch}. Build from source instead: clone https://github.com/${REPO} and run 'bun run build' in tools/cli." ;;
    esac
}

# Ensure curl or wget is available. curl is preferred — both the GitHub API
# fetch and the HEAD probe in verify_release_exists have a cleaner curl path.
# Sets the $DOWNLOADER global.
check_dependencies() {
    if command -v curl &>/dev/null; then
        DOWNLOADER="curl"
    elif command -v wget &>/dev/null; then
        DOWNLOADER="wget"
    else
        error "curl or wget is required"
    fi
}

# Stream a URL to a file with a visible progress bar, then announce completion.
# wget --show-progress is preferred when available; fall back to plain quiet
# mode on ancient wgets that don't recognize the flag.
download_file() {
    local url=$1 dest=$2
    info "Downloading from $url"
    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fL --progress-bar "$url" -o "$dest"
    elif wget --help 2>&1 | grep -q -- --show-progress; then
        wget -q --show-progress "$url" -O "$dest"
    else
        wget -q "$url" -O "$dest"
    fi
    success "Download complete"
}

# Verify the downloaded binary against the release's SHA256SUMS file. Releases
# that predate checksum publishing won't have one — warn and continue rather
# than hard-fail, so the installer keeps working against older tags.
verify_checksum() {
    local file=$1 tag=$2 asset="$ASSET_NAME"
    local sums_url="https://github.com/${REPO}/releases/download/${tag}/tale_checksums.txt"
    local sums expected actual

    if [ "$DOWNLOADER" = "curl" ]; then
        sums=$(curl -fsSL "$sums_url" 2>/dev/null || true)
    else
        sums=$(wget -qO- "$sums_url" 2>/dev/null || true)
    fi
    if [ -z "$sums" ]; then
        info "No checksum file published for ${tag}; skipping verification."
        return
    fi

    expected=$(printf '%s\n' "$sums" | awk -v n="$asset" '$2==n {print $1}')
    if [ -z "$expected" ]; then
        info "No checksum entry for ${asset}; skipping verification."
        return
    fi

    if command -v sha256sum &>/dev/null; then
        actual=$(sha256sum "$file" | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
        actual=$(shasum -a 256 "$file" | awk '{print $1}')
    else
        info "No sha256 tool found; skipping verification."
        return
    fi

    if [ "$actual" != "$expected" ]; then
        error "Checksum mismatch for ${asset} (expected ${expected}, got ${actual}). Aborting."
    fi
    success "Checksum verified"
}

# Resolve the latest release tag from the releases/latest redirect. Consumes
# no API quota, but cannot check assets — used only as the fallback when the
# GitHub API is rate limited or unreachable. Prints the tag, or nothing.
get_latest_tag_from_redirect() {
    local latest_url="https://github.com/${REPO}/releases/latest"
    local location=""

    if [ "$DOWNLOADER" = "curl" ]; then
        location=$(curl -sI "$latest_url" 2>/dev/null | awk 'tolower($1) == "location:" {print $2}' | tr -d '\r' | tail -n 1 || true)
    else
        location=$(wget --spider --server-response --max-redirect=0 "$latest_url" 2>&1 | awk 'tolower($1) == "location:" {print $2}' | tr -d '\r' | tail -n 1 || true)
    fi

    case "$location" in
        */releases/tag/*) echo "${location##*/}" ;;
        *) echo "" ;;
    esac
}

# Find the first release whose assets include our platform binary. Walks the
# JSON line-by-line: remembers the most recent tag_name and prints it the
# moment the expected asset filename appears in the same release block.
# Sends `Authorization: Bearer $GITHUB_TOKEN` when the env var is set; on a
# rate-limited (403/429) or empty API response, falls back to the
# releases/latest redirect before erroring.
get_latest_tag() {
    local api_url="https://api.github.com/repos/${REPO}/releases"
    local asset_name="$ASSET_NAME"
    local response releases_json http_code tag=""

    if [ "$DOWNLOADER" = "curl" ]; then
        # `-w` appends the HTTP status on its own line; peel it off the body.
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            response=$(curl -sL -w '\n%{http_code}' -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api_url" 2>/dev/null || true)
        else
            response=$(curl -sL -w '\n%{http_code}' "$api_url" 2>/dev/null || true)
        fi
        http_code=$(printf '%s\n' "$response" | tail -n 1)
        releases_json=$(printf '%s\n' "$response" | sed '$d')
    else
        # wget swallows the response body on HTTP errors, so an empty body
        # doubles as the rate-limit signal here.
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            releases_json=$(wget -qO- --header="Authorization: Bearer ${GITHUB_TOKEN}" "$api_url" 2>/dev/null || true)
        else
            releases_json=$(wget -qO- "$api_url" 2>/dev/null || true)
        fi
        http_code=""
    fi

    if [ -z "$releases_json" ] || [ "$http_code" = "403" ] || [ "$http_code" = "429" ]; then
        tag=$(get_latest_tag_from_redirect)
        [ -z "$tag" ] && error "Failed to fetch releases"
        echo "$tag"
        return
    fi

    # Match the asset name with its surrounding JSON quotes — some names are
    # prefixes of others (tale_linux / tale_linux_arm64), so a bare substring
    # match would hit the wrong asset.
    tag=$(echo "$releases_json" | sed -n '/"tag_name"/{ s/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/; h; }; /"'"$asset_name"'"/{ g; p; q; }')

    [ -z "$tag" ] && error "No release found with ${asset_name} binary"
    echo "$tag"
}

# Pick the install directory. An $INSTALL_DIR env override wins outright;
# otherwise, if `tale` is already on PATH, replace it in place, and default
# to /usr/local/bin when neither applies. Sets the $INSTALL_DIR global.
detect_install_dir() {
    if [ -n "${INSTALL_DIR:-}" ]; then
        info "Using install directory from INSTALL_DIR: ${INSTALL_DIR}"
        return
    fi

    local existing
    existing=$(command -v "$BINARY_NAME" 2>/dev/null || true)
    if [ -n "$existing" ]; then
        INSTALL_DIR=$(dirname "$existing")
        info "Found existing installation at ${INSTALL_DIR}"
    else
        INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    fi
}

# Decide which tag to install: $VERSION (with optional "v" prefix) when set,
# otherwise the result of get_latest_tag.
resolve_tag() {
    local requested="${VERSION:-}"
    if [ -z "$requested" ]; then
        get_latest_tag
        return
    fi

    # Accept "v0.9.0" or "0.9.0" — release tags are prefixed with "v".
    case "$requested" in
        v*) echo "$requested" ;;
        *)  echo "v${requested}" ;;
    esac
}

# Pre-flight HEAD probe. Fails fast with a friendly message when the user
# pinned a non-existent VERSION, instead of letting the binary download error
# out halfway through. Also surfaces network errors before we kick off the
# (potentially slow) full download.
verify_release_exists() {
    local url=$1
    local http_code="000"
    if [ "$DOWNLOADER" = "curl" ]; then
        # curl's `-w "%{http_code}"` already prints `000` on transport failure,
        # so `|| true` is just there to keep `set -e` from tripping on curl's
        # non-zero exit (DNS, connection refused, etc.).
        http_code=$(curl -sIL -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
    else
        # wget --spider sends a HEAD; --server-response prints status lines to
        # stderr. Tolerate non-2xx exits so we can inspect 404 explicitly.
        local response
        response=$(wget --spider --server-response --max-redirect=5 "$url" 2>&1) || true
        http_code=$(printf '%s\n' "$response" | awk '/^[[:space:]]*HTTP\// {code=$2} END {print (code==""?"000":code)}')
    fi
    if [ "$http_code" = "404" ]; then
        error "Version ${VERSION} not found. See https://github.com/${REPO}/releases for available versions."
    fi
    if [ "$http_code" = "000" ]; then
        error "Could not reach ${url} to verify version ${VERSION}. Check your network connection or try again later."
    fi
}

# Orchestrate: resolve tag → verify (when pinned) → download → chmod → move
# into place (with sudo if the install directory isn't writable).
install_binary() {
    local binary_url tmp_file tag

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    tag=$(resolve_tag)
    if [ -n "${VERSION:-}" ]; then
        info "Pinned version: ${tag}"
    else
        info "Latest version: ${tag}"
    fi

    binary_url="https://github.com/${REPO}/releases/download/${tag}/${ASSET_NAME}"
    tmp_file="${tmp_dir}/${BINARY_NAME}"

    [ -n "${VERSION:-}" ] && verify_release_exists "$binary_url"

    download_file "$binary_url" "$tmp_file"
    verify_checksum "$tmp_file" "$tag"
    chmod +x "$tmp_file"

    # An INSTALL_DIR override may point at a directory that doesn't exist yet.
    if [ ! -d "$INSTALL_DIR" ]; then
        if ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
            info "Requesting sudo to create ${INSTALL_DIR}"
            sudo mkdir -p "$INSTALL_DIR"
        fi
    fi

    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        info "Requesting sudo to install to ${INSTALL_DIR}"
        sudo mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
}

# Smoke-test the freshly installed binary by running --version. A binary that
# cannot execute (killed by the kernel, wrong architecture, corrupt download)
# must fail the install here — reporting success for a dead binary strands the
# user at the very next command with no explanation.
verify_installation() {
    if ! command -v "$BINARY_NAME" &>/dev/null; then
        error "Installation failed. ${BINARY_NAME} not found in PATH"
    fi

    local version
    if version=$("$BINARY_NAME" --version 2>/dev/null) && [ -n "$version" ]; then
        success "Successfully installed ${BINARY_NAME} (${version})"
        return
    fi

    info "The installed binary did not run. Common causes:"
    if [ "$PLATFORM" = "macos" ]; then
        info "  - macOS refused the binary's code signature ('Killed: 9')."
        info "    Repair it with: codesign --remove-signature \"$(command -v ${BINARY_NAME})\" && codesign -s - \"$(command -v ${BINARY_NAME})\""
        info "  - Gatekeeper quarantine: xattr -d com.apple.quarantine \"$(command -v ${BINARY_NAME})\""
    fi
    info "  - A corrupt download: re-run this installer to fetch it again."
    error "Installation failed. '${BINARY_NAME} --version' did not succeed."
}

main() {
    info "Installing Tale CLI..."

    detect_platform
    info "Detected platform: ${PLATFORM} (${ASSET_NAME})"

    check_dependencies
    detect_install_dir
    install_binary
    verify_installation

    # Hand off to the CLI: `tale init` scaffolds a project (no prerequisites);
    # `tale dev` then installs/starts Docker on demand and launches locally.
    echo
    success "Next: run 'tale init' to create your project, then 'tale dev' to launch it."
}

main

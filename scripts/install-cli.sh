#!/bin/bash
# Tale CLI installer for Linux and macOS.
#
# Usage:           curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
# Pin a version:   curl -fsSL ... | VERSION=0.9.0 bash
# Install dir:     curl -fsSL ... | INSTALL_DIR="$HOME/.local/bin" bash
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

# How to get the CLI where no release binary fits: the build:host script of
# tools/cli compiles it for the machine Bun runs on. Prints the hint.
build_from_source_hint() {
    echo "If Bun (https://bun.sh) runs on this machine, build the CLI from source: clone https://github.com/${REPO}, run 'bun install' and then 'bun run --filter @tale/cli build:host' in the clone, and move tools/cli/dist/tale into a directory on your PATH, such as ${DEFAULT_INSTALL_DIR}."
}

# Map `uname -s` + `uname -m` to the release asset for this machine. Releases
# ship four Unix binaries — tale_macos (arm64), tale_macos_x64, tale_linux
# (x86_64), tale_linux_arm64 — so any other system or architecture gets a
# build-from-source pointer up front instead of a cryptic kernel exec error
# later, and a Windows shell gets the PowerShell installer instead.
# Sets the $PLATFORM and $ASSET_NAME globals.
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        linux*)  PLATFORM="linux" ;;
        darwin*) PLATFORM="macos" ;;
        mingw* | msys* | cygwin*)
            error "This installer is for macOS and Linux. On Windows, run the PowerShell installer: irm https://raw.githubusercontent.com/${REPO}/main/scripts/install-cli.ps1 | iex" ;;
        *)       error "Unsupported OS: ${os}. $(build_from_source_hint)" ;;
    esac

    case "$PLATFORM-$arch" in
        macos-arm64)                 ASSET_NAME="${BINARY_NAME}_macos" ;;
        macos-x86_64)                ASSET_NAME="${BINARY_NAME}_macos_x64" ;;
        linux-x86_64 | linux-amd64)  ASSET_NAME="${BINARY_NAME}_linux" ;;
        linux-aarch64 | linux-arm64) ASSET_NAME="${BINARY_NAME}_linux_arm64" ;;
        *) error "No released binary for ${PLATFORM}/${arch}. $(build_from_source_hint)" ;;
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

# Verify the downloaded binary against the release's SHA256SUMS file. Only a
# missing file (404) is a legacy release; network failures and invalid checksum
# files must not silently turn a verified installation into an unverified one.
verify_checksum() {
    local file=$1 tag=$2 asset="$ASSET_NAME"
    local sums_url="https://github.com/${REPO}/releases/download/${tag}/tale_checksums.txt"
    local sums expected actual response http_code download_ok=true

    if [ "$DOWNLOADER" = "curl" ]; then
        if ! response=$(curl -sSL -w '\n%{http_code}' "$sums_url" 2>/dev/null); then
            error "Could not fetch the checksum file for ${tag} (network error). Aborting rather than installing an unverified binary."
        fi
        http_code=$(printf '%s\n' "$response" | tail -n 1)
        sums=$(printf '%s\n' "$response" | sed '$d')
    else
        local headers="${file}.headers"
        sums=$(wget -O- --server-response "$sums_url" 2>"$headers") || download_ok=false
        http_code=$(awk '/^[[:space:]]*HTTP\// {code=$2} END {print (code==""?"000":code)}' "$headers")
        rm -f "$headers"
    fi
    if [ "$http_code" = "404" ]; then
        info "No checksum file published for ${tag}; skipping verification."
        return
    fi
    if [ "$http_code" != "200" ] || [ "$download_ok" = false ]; then
        error "Could not fetch the checksum file for ${tag} (HTTP ${http_code}). Aborting rather than installing an unverified binary."
    fi

    expected=$(printf '%s\n' "$sums" | awk -v n="$asset" '$2==n {print tolower($1)}')
    if [ -z "$expected" ]; then
        error "No checksum entry for ${asset}. Aborting rather than installing an unverified binary."
    fi
    if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
        error "Invalid checksum entry for ${asset}. Aborting."
    fi

    if command -v sha256sum &>/dev/null; then
        actual=$(sha256sum "$file" | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
        actual=$(shasum -a 256 "$file" | awk '{print $1}')
    else
        error "sha256sum or shasum is required to verify the download. Install one and run this installer again."
    fi

    if [ "$actual" != "$expected" ]; then
        error "Checksum mismatch for ${asset} (expected ${expected}, got ${actual}). Aborting."
    fi
    success "Checksum verified"
}

# Resolve the latest release tag from the releases/latest redirect. Consumes
# no API quota, but cannot check assets — used only as the fallback when the
# GitHub API gives no release list. Prints the tag, or nothing.
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

# Say why the release lookup failed once the redirect found no tag either:
# 000 is no answer at all, and a 401 while GITHUB_TOKEN is set means GitHub
# refused the token, which no retry fixes. Prints the message.
get_lookup_failure() {
    local http_code=$1
    if [ "$http_code" = "000" ]; then
        echo "Failed to fetch releases (network error). Check your connection to GitHub and try again."
    elif [ "$http_code" = "401" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
        echo "Failed to fetch releases (HTTP 401). GitHub refused GITHUB_TOKEN, which may be wrong or expired: fix or unset it, then try again."
    else
        echo "Failed to fetch releases (HTTP ${http_code}). Try again later."
    fi
}

# Find the first release whose assets include our platform binary. Walks the
# JSON line-by-line: remembers the most recent tag_name and prints it the
# moment the expected asset filename appears in the same release block.
# Sends `Authorization: Bearer $GITHUB_TOKEN` when the env var is set. Only a
# complete 200 is a release list: any other status (a refused token, a rate
# limit, a server error), a failed transfer or an empty body falls back to the
# releases/latest redirect, and the error names the status when that fails too.
get_latest_tag() {
    local api_url="https://api.github.com/repos/${REPO}/releases"
    local asset_name="$ASSET_NAME"
    local response releases_json http_code headers tag="" download_ok=true

    if [ "$DOWNLOADER" = "curl" ]; then
        # `-w` appends the HTTP status on its own line; peel it off the body.
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            response=$(curl -sL -w '\n%{http_code}' -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api_url" 2>/dev/null) || download_ok=false
        else
            response=$(curl -sL -w '\n%{http_code}' "$api_url" 2>/dev/null) || download_ok=false
        fi
        http_code=$(printf '%s\n' "$response" | tail -n 1)
        releases_json=$(printf '%s\n' "$response" | sed '$d')
    else
        # wget prints the response headers on stderr and drops the body of an
        # HTTP error; the last status line is the answer's.
        headers=$(mktemp)
        if [ -n "${GITHUB_TOKEN:-}" ]; then
            releases_json=$(wget -O- --server-response --header="Authorization: Bearer ${GITHUB_TOKEN}" "$api_url" 2>"$headers") || download_ok=false
        else
            releases_json=$(wget -O- --server-response "$api_url" 2>"$headers") || download_ok=false
        fi
        http_code=$(awk '/^[[:space:]]*HTTP\// {code=$2} END {print (code==""?"000":code)}' "$headers")
        rm -f "$headers"
    fi

    if [ "$http_code" != "200" ] || [ "$download_ok" = false ] || [ -z "$releases_json" ]; then
        # A transfer that broke off after its 200 got no complete answer.
        [ "$download_ok" = false ] && [ "$http_code" = "200" ] && http_code="000"
        tag=$(get_latest_tag_from_redirect)
        [ -z "$tag" ] && error "$(get_lookup_failure "${http_code:-000}")"
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

    # Keep verification and the printed PATH command usable for relative overrides.
    INSTALL_DIR=$(cd "$INSTALL_DIR" && pwd)

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
    local binary_path="${INSTALL_DIR}/${BINARY_NAME}" version
    if [ ! -x "$binary_path" ]; then
        error "Installation failed. ${BINARY_NAME} not found at ${binary_path}"
    fi

    if version=$("$binary_path" --version 2>/dev/null) && [ -n "$version" ]; then
        success "Successfully installed ${BINARY_NAME} (${version})"
        return
    fi

    info "The installed binary did not run. Common causes:"
    if [ "$PLATFORM" = "macos" ]; then
        info "  - macOS refused the binary's code signature ('Killed: 9')."
        info "    Repair it with: codesign --remove-signature \"${binary_path}\" && codesign -s - \"${binary_path}\""
        info "  - Gatekeeper quarantine: xattr -d com.apple.quarantine \"${binary_path}\""
    fi
    info "  - A corrupt download: re-run this installer to fetch it again."
    error "Installation failed. '${BINARY_NAME} --version' did not succeed."
}

# A piped installer cannot change the parent shell's PATH. Give an exact,
# shell-escaped command when Tale is missing or another installation wins.
# Leave shell startup files under the user's control.
explain_path() {
    local existing path_command
    existing=$(command -v "$BINARY_NAME" 2>/dev/null || true)
    if [ -n "$existing" ] && [ "$existing" -ef "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        return
    fi

    printf -v path_command 'export PATH=%q:"$PATH"' "$INSTALL_DIR"
    info "Add this installation to PATH in your terminal before continuing:"
    info "  ${path_command}"
    info "Add the same line to your shell profile to keep Tale available in new terminals."
}

main() {
    info "Installing Tale CLI..."

    detect_platform
    info "Detected platform: ${PLATFORM} (${ASSET_NAME})"

    check_dependencies
    detect_install_dir
    install_binary
    verify_installation
    explain_path

    # Hand off to the CLI: `tale init` scaffolds a project (no prerequisites);
    # `tale dev` then installs/starts Docker on demand and launches locally.
    echo
    success "Next: run 'tale init' to create your project, then 'tale dev' to launch it."
}

main

#!/bin/bash
# Tale CLI installer for Linux and macOS.
#
# Usage:           curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
# Pin a version:   VERSION=0.9.0 curl -fsSL ... | bash
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

# Map `uname -s` to the platform suffix used in our release asset names
# (tale_linux, tale_macos). Sets the $PLATFORM global.
detect_platform() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')

    case "$os" in
        linux*)  PLATFORM="linux" ;;
        darwin*) PLATFORM="macos" ;;
        *)       error "Unsupported OS: $os" ;;
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

# Find the first release whose assets include our platform binary. Walks the
# JSON line-by-line: remembers the most recent tag_name and prints it the
# moment the expected asset filename appears in the same release block.
get_latest_tag() {
    local api_url="https://api.github.com/repos/${REPO}/releases"
    local asset_name="${BINARY_NAME}_${PLATFORM}"
    local releases_json

    if [ "$DOWNLOADER" = "curl" ]; then
        releases_json=$(curl -fsSL "$api_url")
    else
        releases_json=$(wget -qO- "$api_url")
    fi

    [ -z "$releases_json" ] && error "Failed to fetch releases"

    local tag=""
    tag=$(echo "$releases_json" | sed -n '/"tag_name"/{ s/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/; h; }; /'"$asset_name"'/{ g; p; q; }')

    [ -z "$tag" ] && error "No release found with ${asset_name} binary"
    echo "$tag"
}

# Pick the install directory. If `tale` is already on PATH, replace it in
# place; otherwise default to /usr/local/bin. Sets the $INSTALL_DIR global.
detect_install_dir() {
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
        http_code=$(curl -sIL -o /dev/null -w "%{http_code}" "$url" || echo "000")
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

    binary_url="https://github.com/${REPO}/releases/download/${tag}/${BINARY_NAME}_${PLATFORM}"
    tmp_file="${tmp_dir}/${BINARY_NAME}"

    [ -n "${VERSION:-}" ] && verify_release_exists "$binary_url"

    download_file "$binary_url" "$tmp_file"
    chmod +x "$tmp_file"

    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        info "Requesting sudo to install to ${INSTALL_DIR}"
        sudo mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
}

# Smoke-test the freshly installed binary by running --version. The version
# string is folded into the success message when available.
verify_installation() {
    if command -v "$BINARY_NAME" &>/dev/null; then
        local version
        version=$("$BINARY_NAME" --version 2>/dev/null || true)
        if [ -n "$version" ]; then
            success "Successfully installed ${BINARY_NAME} (${version})"
        else
            success "Successfully installed ${BINARY_NAME}"
        fi
    else
        error "Installation failed. ${BINARY_NAME} not found in PATH"
    fi
}

main() {
    info "Installing Tale CLI..."

    detect_platform
    info "Detected platform: ${PLATFORM}"

    check_dependencies
    detect_install_dir
    install_binary
    verify_installation

    success "Run 'tale --help' to get started."
}

main

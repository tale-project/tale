#!/bin/bash
set -euo pipefail

REPO="tale-project/tale"
BINARY_NAME="tale"
INSTALL_DIR="/usr/local/bin"

info() { printf "\033[1;34m%s\033[0m\n" "$1"; }
success() { printf "\033[1;32m%s\033[0m\n" "$1"; }
error() { printf "\033[1;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

detect_platform() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')

    case "$os" in
        linux*)  PLATFORM="linux" ;;
        darwin*) PLATFORM="macos" ;;
        *)       error "Unsupported OS: $os" ;;
    esac
}

check_dependencies() {
    if command -v curl &>/dev/null; then
        DOWNLOADER="curl"
    elif command -v wget &>/dev/null; then
        DOWNLOADER="wget"
    else
        error "curl or wget is required"
    fi
}

download() {
    local url=$1 dest=$2
    info "Downloading from $url"
    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fsSL "$url" -o "$dest"
    else
        wget -q "$url" -O "$dest"
    fi
}

install_binary() {
    local binary_url tmp_file

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    binary_url="https://github.com/${REPO}/releases/latest/download/${BINARY_NAME}_${PLATFORM}"
    tmp_file="${tmp_dir}/${BINARY_NAME}"

    download "$binary_url" "$tmp_file"
    chmod +x "$tmp_file"

    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        info "Requesting sudo to install to ${INSTALL_DIR}"
        sudo mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
}

verify_installation() {
    if command -v "$BINARY_NAME" &>/dev/null; then
        success "Successfully installed ${BINARY_NAME}"
        "$BINARY_NAME" --version 2>/dev/null || true
    else
        error "Installation failed. ${BINARY_NAME} not found in PATH"
    fi
}

main() {
    info "Installing Tale CLI..."

    detect_platform
    info "Detected platform: ${PLATFORM}"

    check_dependencies
    install_binary
    verify_installation

    success "Run 'tale --help' to get started"
}

main

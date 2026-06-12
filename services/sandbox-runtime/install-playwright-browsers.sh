#!/bin/sh
# Install Playwright browsers for the MCP's BUNDLED playwright without its
# own downloader: the bundled playwright's out-of-process download/extract
# helper (oopDownloadBrowserMain) can deadlock mid-extraction under buildkit
# (zero-CPU hang holding a half-written file), and silently hangs the build.
# System curl + unzip do the same job reliably.
#
# Revision coupling stays automatic: install locations and URLs come from
# `playwright install --dry-run`, i.e. from the bundled registry itself —
# bumping PLAYWRIGHT_MCP_VERSION re-resolves everything. Honors
# PLAYWRIGHT_BROWSERS_PATH and PLAYWRIGHT_DOWNLOAD_HOST like the real
# installer. INSTALLATION_COMPLETE is the marker file the registry expects.
set -eu

PLAYWRIGHT_BIN="$1" # bundled playwright CLI
shift               # remaining args: browsers to install (e.g. chromium)

plan=$("$PLAYWRIGHT_BIN" install --dry-run "$@")
echo "$plan"

echo "$plan" | awk '
  /Install location:/ { dir = $3 }
  /Download url:/     { print dir, $3 }
' | sort -u | while read -r dir url; do
  echo "installing $dir"
  tmp=$(mktemp /tmp/pw-browser-XXXXXX.zip)
  curl -fsSL --retry 3 -o "$tmp" "$url"
  mkdir -p "$dir"
  unzip -q "$tmp" -d "$dir"
  rm -f "$tmp"
  touch "$dir/INSTALLATION_COMPLETE"
done

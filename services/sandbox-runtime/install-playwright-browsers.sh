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
# installer. Only the official Chromium headless shell is needed: ordinary
# chromium.launch({ headless: true }) already selects it. The MCP's chromium
# channel selects full Chromium instead, so the launcher reads the executable
# recorded below and passes its supported --executable-path option.
# INSTALLATION_COMPLETE is the marker file the registry expects.
set -eu

PLAYWRIGHT_BIN="$1" # bundled playwright CLI
BROWSER_MANIFEST="$2" # root-owned metadata, outside the writable browser cache

plan=$("$PLAYWRIGHT_BIN" install --dry-run --only-shell chromium)
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

# Read the executable from the same bundled registry, rather than guessing an
# archive layout or making a fake full-Chromium installation marker. Fail the
# build if the archive did not supply its expected executable.
node - "$PLAYWRIGHT_BIN" "$BROWSER_MANIFEST" <<'NODEEOF'
const fs = require('node:fs');
const path = require('node:path');
const cli = fs.realpathSync(process.argv[2]);
const paths = [path.dirname(cli)];
const { registry, registryDirectory } = require(require.resolve('playwright-core/lib/server/registry/index', { paths }));
const executablePath = registry.findExecutable('chromium-headless-shell').executablePath('javascript');
fs.accessSync(executablePath, fs.constants.X_OK);
const serverPackage = require.resolve('@playwright/mcp/package.json', { paths });
const server = fs.realpathSync(path.join(path.dirname(serverPackage), 'cli.js'));
const serverVersion = JSON.parse(fs.readFileSync(serverPackage, 'utf8')).version;
const manifest = process.argv[3];
fs.mkdirSync(path.dirname(manifest), { recursive: true });
fs.writeFileSync(manifest, JSON.stringify({ executablePath, server, serverVersion, browsersPath: registryDirectory }));
NODEEOF

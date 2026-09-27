/**
 * The commands the "Add device" dialog hands out. One line installs the Tale
 * CLI and connects the machine; the second form is for a machine that already
 * has the CLI. Both carry the deployment's own site URL (from the join-token
 * answer, i.e. the server's `SITE_URL`) and the single-use join token.
 */

/** The published installer (docs: self-hosted/install/cli-install). */
export const CLI_INSTALL_URL =
  'https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh';

const RELEASE_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Quote a value for a POSIX shell unless it is plainly safe as is. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9._:/@%+=-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function connectCommand(serverUrl: string, token: string): string {
  return `tale sandbox connect ${shellWord(serverUrl)} --token ${shellWord(token)}`;
}

/**
 * Install (pinned to the server's release when it runs one, so the CLI and
 * the server speak the same version) and connect, in one line. `&&` keeps
 * the connect from running when the install failed.
 */
export function installAndConnectCommand(
  serverUrl: string,
  token: string,
  serverVersion: string,
): string {
  const pin = RELEASE_RE.test(serverVersion) ? `VERSION=${serverVersion} ` : '';
  return `curl -fsSL ${CLI_INSTALL_URL} | ${pin}bash && ${connectCommand(serverUrl, token)}`;
}

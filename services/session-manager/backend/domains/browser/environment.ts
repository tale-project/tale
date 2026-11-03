// The environment a browser is started with. camoufox-js hands every browser a
// copy of the app's own environment, and a page that exploits the browser
// reads it: a token or a password the host has in its environment (a CI
// token, a cloud key) is not for a web browser. Only what names a secret is
// left out, so that nothing a browser needs (`HOME`, `LANG`, `DISPLAY`,
// `XDG_*`, `MOZ_*`, a certificate file, a proxy of the host) goes missing.

/** Names that say the value is a secret: `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD`. */
const SECRET_NAME = /token|secret|passw(?:or)?d|credential|key/i;

/** `env` without the variables whose names say they hold a secret (and those not set). */
export function browserEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !SECRET_NAME.test(name)) kept[name] = value;
  }
  return kept;
}

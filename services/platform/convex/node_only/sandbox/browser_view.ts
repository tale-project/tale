/**
 * Live browser-view operator flag (env SANDBOX_BROWSER_VIEW), parsed DEFAULT-ON
 * (opt-out). When enabled the spawner launches the session container with a
 * headed Chromium + read-only x11vnc mirror (TALE_BROWSER_CDP) and the platform
 * attaches Playwright MCP over CDP, so the agent's browser streams read-only
 * into the chat UI. Disabled ⇒ the agent still uses a headless browser, just
 * with no live preview.
 *
 * ONE env value drives BOTH sides — the sandbox spawner reads SANDBOX_BROWSER_VIEW
 * directly (services/sandbox config) and the platform reads it through this
 * helper — so they stay in lockstep. A one-sided flag is a misconfig:
 * platform-on/spawner-off attaches to a CDP endpoint that was never started;
 * spawner-on/platform-off wastes a headed browser the agent never attaches to.
 *
 * Default ON; set SANDBOX_BROWSER_VIEW to one of `0`/`false`/`no`/`off` to opt
 * out. Empty/unset ⇒ on. This mirrors the spawner-side `boolEnvOpt(...) ?? true`
 * default so the two sides agree when the operator sets nothing.
 */
export function browserViewEnabled(): boolean {
  const v = process.env.SANDBOX_BROWSER_VIEW?.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

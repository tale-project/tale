'use node';

// Tier-2 credential broker for sandbox sessions. Resolves an external turn's
// brokerable connector grants into the env its exec needs, decrypting each
// via the connector-credentials path (`resolveConnectorCredential`). The
// external-turn lane calls this per turn and merges the result into the
// exec's PER-EXEC env overlay — never the session env store: the agent
// session is per-user and long-lived while a grant is per-turn, so a
// session-level patch would leak a granted turn's token into every later
// ungranted turn, would need an explicit unset to revoke, and is lost on
// container recreation anyway. The per-exec overlay dies with the exec.
//
// A grant is brokerable when its connector declares a git capability
// (`git` in its `connector.yml`): the credential's token also opens the
// vendor's git remotes. Every such grant adds one line to
// `TALE_GIT_CREDENTIALS` — the git host, the username git sends and the
// token — and the in-image `tale-git-credential` helper answers each host
// from those lines and nothing else, github.com and a Forgejo instance
// alike. A project agent may pin which of the organization's credentials a
// connector resolves to (`connectorCredentials`); a pin the organization no
// longer holds hands the turn nothing for that connector, never the default.
//
// Alongside the credential helper, this also provisions the git author
// identity (user.name / user.email) so a fresh container can `git commit`
// without a manual `git config`: the person who owns the session, else the
// agent's own commit identity — see `resolveGitIdentity` below.
//
// Secrets are decrypted in this Node module and returned to the caller (which
// carries them in the exec body) — they are NEVER baked into the container
// image / Pod spec / docker inspect, never written into the workspace, and
// never logged; every fetch is audited (sandboxCredentialAccess). This is the
// deliberate, scoped Tier-2 relaxation: explicit per-turn grant + audit +
// per-exec lifetime.

import type { ProjectAgentGitIdentity } from '@tale/shared/schemas/projects';

import { findConnector } from '../../connector_credentials/connector_catalog';
import { resolveConnectorCredential } from '../../connector_credentials/resolve_credential';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';

/** The env variable the git credential helper reads its host map from: one
 * `<host> <username> <token>` line per brokered git host. */
export const GIT_CREDENTIALS_ENV = 'TALE_GIT_CREDENTIALS';

/** Where the runtime image installs the helper. */
const GIT_CREDENTIAL_HELPER = '/usr/local/bin/tale-git-credential';

/** A git host as git names it in a credential request: a lower-case host
 * name, with a port when the remote is not on 443. */
const GIT_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;

/** A value that can ride one helper line unchanged: printable ASCII with no
 * space (git's credential protocol forbids line breaks in values too). */
const PLAIN_VALUE_RE = /^[\x21-\x7e]+$/;

/**
 * Whether a granted connector's credential is resolved into the sandbox:
 * its connector declares a git capability. Every other granted connector
 * stays dispatch-only behind the MCP bridge (its secret never enters the
 * box); a git-capable one is the exception, made because the capability
 * lives in a CLI the agent drives directly (git).
 */
export function isBrokerableGrant(slug: string): boolean {
  return findConnector(slug)?.git !== undefined;
}

/**
 * The credentials a confined run goes without, by the names the model would
 * look for: for each equipped git-capable connector, `GITHUB_TOKEN` for
 * GitHub (the variable its CLI reads) and `<slug> git access` for any other.
 */
export function brokeredCredentialNames(
  connectors: readonly string[],
): string[] {
  return connectors
    .filter(isBrokerableGrant)
    .map((slug) => (slug === 'github' ? 'GITHUB_TOKEN' : `${slug} git access`));
}

/** Env a connector's token is also offered under, for its own CLI: GitHub's
 * `gh` reads GITHUB_TOKEN / GH_TOKEN. Others need none beyond git. */
function cliEnv(slug: string, token: string): Record<string, string> {
  return slug === 'github' ? { GITHUB_TOKEN: token, GH_TOKEN: token } : {};
}

/** The single secret string to expose for a credential, from the named
 * bindings `resolveConnectorCredential` returns (prefer an OAuth access
 * token, then a bearer token, then an API key, then a basic-auth password). */
function pickSecret(secrets: Record<string, string>): string | null {
  return (
    secrets.accessToken ??
    secrets.token ??
    secrets.apiKey ??
    secrets.password ??
    null
  );
}

/** The git host a credential opens: the connector's fixed host, or the host
 * of the credential's own endpoint. `null` when there is none to take. */
function gitHostOf(
  declared: string,
  endpoint: string | undefined,
): string | null {
  if (declared !== 'endpoint') return declared;
  if (endpoint === undefined) return null;
  try {
    const host = new URL(endpoint).host.toLowerCase();
    return GIT_HOST_RE.test(host) ? host : null;
  } catch (error) {
    console.warn(
      '[sandbox.broker] a credential endpoint is not a URL:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/** Assemble contiguous `GIT_CONFIG_COUNT`/`KEY_i`/`VALUE_i` env pairs
 * (equivalent to repeated `-c key=value`) from an ordered list — git requires
 * the KEY_i/VALUE_i indices to be contiguous from 0, so this is the single
 * place that numbers them. Empty input yields no GIT_CONFIG_* env at all. */
export function buildGitConfigEnv(
  pairs: Array<{ key: string; value: string }>,
): Record<string, string> {
  if (pairs.length === 0) return {};
  const env: Record<string, string> = {
    GIT_CONFIG_COUNT: String(pairs.length),
  };
  pairs.forEach((pair, i) => {
    env[`GIT_CONFIG_KEY_${i}`] = pair.key;
    env[`GIT_CONFIG_VALUE_${i}`] = pair.value;
  });
  return env;
}

/** One brokered git host, as the turn's audit and tests read it — never the
 * token. */
export interface BrokeredGitHost {
  slug: string;
  host: string;
  username: string;
}

/**
 * Resolve a turn's brokerable grants (plus its git identity) into exec env.
 * Best-effort per grant: a missing/disabled/undecryptable credential is
 * skipped with a warning — the turn runs without it and git reports the
 * absence loudly — never thrown, so a broker gap can only ever downgrade a
 * turn, not kill it.
 */
export async function resolveSessionCredentialEnv(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    grants: readonly string[];
    kind: 'bootstrap' | 'git';
    /** The credential each connector resolves to, by name, where the agent
     * pins one; any other grant takes the connector's default. */
    connectorCredentials?: Readonly<Record<string, string>>;
    /** The agent's own commit identity, for a session no person owns. */
    gitIdentity?: ProjectAgentGitIdentity | null;
  },
): Promise<{
  env: Record<string, string>;
  git: BrokeredGitHost[];
}> {
  const env: Record<string, string> = {};
  const git: BrokeredGitHost[] = [];
  const lines: string[] = [];

  for (const slug of args.grants) {
    const capability = findConnector(slug)?.git;
    if (capability === undefined) continue;
    const pinned = args.connectorCredentials?.[slug];
    let secret: string | null;
    let username = capability.username;
    let host: string | null;
    try {
      const credential = await resolveConnectorCredential(ctx, {
        organizationId: args.organizationId,
        connectorSlug: slug,
        // A pinned credential and nothing else: one that is gone fails here,
        // and the turn goes without, rather than falling back to a default
        // that may reach more.
        ...(pinned !== undefined ? { credentialRef: pinned } : {}),
      });
      secret = pickSecret(credential.secrets);
      // A username-and-password credential sends its own username.
      if (
        credential.authMethod === 'basic' &&
        credential.secrets.username !== undefined
      ) {
        username = credential.secrets.username;
      }
      host = gitHostOf(capability.host, credential.endpoint);
    } catch (err) {
      // No credential, disabled, needs-reauth, or an undecryptable envelope —
      // each already a typed refusal with no secret material. Skip the grant
      // like a missing credential; the message says which case it was.
      console.warn(
        `[sandbox.broker] grant '${slug}'${pinned !== undefined ? ' (pinned)' : ''} is not resolvable:`,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }
    if (secret === null) {
      console.warn(`[sandbox.broker] grant '${slug}' has no usable secret`);
      continue;
    }
    if (host === null) {
      console.warn(
        `[sandbox.broker] grant '${slug}' names no git host its credential can open`,
      );
      continue;
    }
    if (!PLAIN_VALUE_RE.test(secret) || !PLAIN_VALUE_RE.test(username)) {
      console.warn(
        `[sandbox.broker] grant '${slug}' carries a token or username git cannot be handed`,
      );
      continue;
    }
    if (git.some((entry) => entry.host === host)) {
      console.warn(
        `[sandbox.broker] grant '${slug}' opens ${host}, which an earlier grant already opens; keeping the earlier one`,
      );
      continue;
    }
    lines.push(`${host} ${username} ${secret}`);
    git.push({ slug, host, username });
    Object.assign(env, cliEnv(slug, secret));

    // Audit every fetch (the Tier-2 traceability requirement).
    await ctx.runMutation(
      internal.sandbox.session_mutations.recordCredentialAccess,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        slug,
        kind: args.kind,
      },
    );
  }

  const gitConfigPairs: Array<{ key: string; value: string }> = [];

  // Activate the in-image `tale-git-credential` helper for every git op in the
  // exec. The helper is installed in the runtime image but inert until git
  // is told to use it — without this, `git push` to https finds no credentials
  // and aborts ("could not read Username"). Injected via GIT_CONFIG_* env
  // (equivalent to `-c credential.helper=…`) so it needs no in-session
  // `git config` exec and covers clone/fetch/push. The helper answers only
  // for the hosts in TALE_GIT_CREDENTIALS and emits nothing otherwise.
  if (lines.length > 0) {
    env[GIT_CREDENTIALS_ENV] = lines.join('\n');
    gitConfigPairs.push({
      key: 'credential.helper',
      value: GIT_CREDENTIAL_HELPER,
    });
  }

  // Provision the git AUTHOR IDENTITY beside the credential helper (never
  // gated on a git grant, unlike the helper above): name/email are
  // non-secret metadata, not a credential, and Claude Code's `Git user:`
  // context line reads `git config user.name` at conversation start
  // regardless of whether the turn was granted git access.
  const identity = await resolveGitIdentity(ctx, args);
  if (identity) {
    gitConfigPairs.push(
      { key: 'user.name', value: identity.name },
      { key: 'user.email', value: identity.email },
    );
  }

  Object.assign(env, buildGitConfigEnv(gitConfigPairs));

  return { env, git };
}

/**
 * Whose name and email the turn's commits carry [SBX-R42]: the person who
 * owns the session, when one does; otherwise the agent's own commit
 * identity, when it has one. A project agent's workers are owned by Tale
 * itself, so its runs — whoever or whatever started them: a person, the
 * dispatch, a standing role, a schedule — commit as the agent. With neither,
 * no identity is set, rather than a placeholder.
 */
async function resolveGitIdentity(
  ctx: ActionCtx,
  args: {
    sessionId: string;
    gitIdentity?: ProjectAgentGitIdentity | null;
  },
): Promise<{ name: string; email: string } | null> {
  const owner: { name: string; email: string } | null = await ctx.runQuery(
    internal.sandbox.session_queries.getSessionOwnerIdentity,
    { sessionId: args.sessionId },
  );
  if (owner) return owner;
  return args.gitIdentity ?? null;
}

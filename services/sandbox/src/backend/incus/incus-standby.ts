// The standby protocol of the warm pool.
//
// A standby instance is started ahead of time so that a session's handout
// does not pay for the instance's start (the 5 s an OCI container with a
// bridged NIC waits for DHCP). The session's identity cannot be given to a
// running instance as environment — runnerd reads its token when it boots,
// and Incus can neither rename nor re-environment a running instance — so the
// instance boots a small script instead of the image's entrypoint. The script
// waits for the spawner to push a claim file and then becomes the entrypoint,
// with the claim's variables in its environment, exactly as a cold session
// would have started.
//
//   standby instance:  oci.entrypoint = /bin/bash /usr/local/lib/tale/standby.sh
//   spawner, at claim: labels + workspace volume (instance PATCH), then
//                      POST /files  /run/tale-standby/claim.env
//   script:            sources the claim, removes it, cd /agent, exec's
//                      /docker-entrypoint.sh daemon
//
// bash waits with `read -t` on a FIFO it holds open, which wakes up without
// forking, so an idle standby costs next to nothing.

export const STANDBY_SCRIPT_PATH = '/usr/local/lib/tale/standby.sh';
const STANDBY_DIR = '/run/tale-standby';
export const STANDBY_READY_FILE = `${STANDBY_DIR}/ready`;
export const STANDBY_CLAIM_FILE = `${STANDBY_DIR}/claim.env`;
/** The last line of a complete claim file. */
export const STANDBY_CLAIM_END = '# tale-claim-end';
/** The command line of a standby instance (`oci.entrypoint`). */
export const STANDBY_COMMAND = `/bin/bash ${STANDBY_SCRIPT_PATH}`;

const IMAGE_ENTRYPOINT = '/docker-entrypoint.sh';

export interface StandbyScriptOptions {
  dir?: string;
  /** What the claim turns the instance into. */
  entrypoint?: string;
  /** The working directory the entrypoint starts in. */
  workdir?: string;
}

/**
 * The script. Exit codes: 70 the standby directory could not be made, 71 the
 * workspace is not there. Parameterised so the unit test can run it in a
 * temporary directory against a stub entrypoint; production uses the defaults.
 */
export function standbyScript(options: StandbyScriptOptions = {}): string {
  const dir = options.dir ?? STANDBY_DIR;
  const entrypoint = options.entrypoint ?? IMAGE_ENTRYPOINT;
  const workdir = options.workdir ?? '/agent';
  return `#!/bin/bash
# Tale sandbox standby: wait for the spawner's claim, then become the session.
# Written by services/sandbox (incus-standby.ts); see docs/incus.md.
set -u
dir='${dir}'
claim="$dir/claim.env"
mkdir -p "$dir" && chmod 0700 "$dir" || exit 70
mkfifo "$dir/hold" || exit 70
exec 9<>"$dir/hold"
: > "$dir/ready" || exit 70
until [ -f "$claim" ] && grep -q '^${STANDBY_CLAIM_END}$' "$claim"; do
  read -r -t 0.05 -u 9 _ || true
done
exec 9>&-
. "$claim"
rm -rf "$dir"
cd '${workdir}' || exit 71
if [ -n "\${TALE_STANDBY_UID:-}" ]; then
  uid="$TALE_STANDBY_UID"
  gid="\${TALE_STANDBY_GID:-$TALE_STANDBY_UID}"
  unset TALE_STANDBY_UID TALE_STANDBY_GID
  exec setpriv --reuid "$uid" --regid "$gid" --init-groups -- '${entrypoint}' daemon
fi
exec '${entrypoint}' daemon
`;
}

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const VALUE_RE = /^[A-Za-z0-9_.:/+=@-]*$/;

/**
 * The claim file: `export NAME='value'` lines the script sources. Both sides
 * are checked against a narrow alphabet (a hex token, digits, a literal
 * address), so nothing here is a shell command whatever the caller passes.
 */
export function claimFile(variables: Record<string, string>): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(variables)) {
    if (!NAME_RE.test(name)) {
      throw new Error(`claim variable name rejected: ${JSON.stringify(name)}`);
    }
    if (!VALUE_RE.test(value)) {
      throw new Error(`claim variable ${name} has a value that is not plain`);
    }
    lines.push(`export ${name}='${value}'`);
  }
  lines.push(STANDBY_CLAIM_END, '');
  return lines.join('\n');
}

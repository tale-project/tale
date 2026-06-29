---
name: security
description: Secure-coding practice for Tale — the OWASP boundary checklist, the blocking SAST gate (Opengrep), boundary validation with Zod, secret handling, and the sandbox SSRF egress model. Read before touching a request handler, the file system, or a shell; handling secrets or auth; fixing a SAST finding; or working on the sandbox egress. For a full review pass use the built-in security-review skill.
---

# security

Secure-coding rules for the whole monorepo, plus the two enforcement points: the **SAST gate** in
[`tools/opengrep/`](../../../tools/opengrep/) and the **sandbox SSRF firewall**
([`services/sandbox-egress`](../../../services/sandbox-egress/) +
[`services/sandbox-runtime`](../../../services/sandbox-runtime/)). Per-row access control is
[`convex`](../convex/SKILL.md)'s job (`queryWithRLS`/`mutationWithRLS`); container hardening is
[`docker`](../docker/SKILL.md)'s. For a full audit pass of a diff, invoke the built-in
**security-review** skill — don't reimplement it here.

## When this applies

Any change that handles untrusted input in a request handler
([`convex/http.ts`](../../../services/platform/convex/http.ts), FastAPI routers), touches the file
system or spawns a shell/subprocess, reads or writes secrets, gates auth, or edits
`services/sandbox-egress` / `services/sandbox-runtime`. Also when a SAST finding blocks
`bun run lint:sast`.

## The rules

- **Treat all boundary input as adversarial — name the attack class.** On any change touching a
  request handler, the file system, or a shell, actively check for: command injection, XSS, SQL
  injection, SSRF, auth bypass, IDOR, unsafe deserialization. Don't assume the caller is the UI —
  assume an attacker. (The default reflex skips this; naming the classes is the point.)
- **Parameterized queries and argv arrays only.** Never string-concatenate or template-interpolate
  into SQL or a shell command. Bound parameters for SQL; `execFile`/`spawn` with an argument array
  (never `exec`/`execSync` on an interpolated string) — both SAST-gated below.
- **Secrets come from the environment, never source.** No hardcoded keys, tokens, or PEM blocks
  (gated by `ts-no-private-key-literal` + the `secrets`/`gitleaks` packs). Scrub secrets from logs and
  error messages before committing; HTTP handlers must not log request secrets.
- **Validate at the boundary with Zod, server-side.** Untrusted payloads get a Zod schema from
  [`lib/shared/schemas/`](../../../services/platform/lib/shared/schemas/) (`zod/v4`) — the server is
  the authority even when the UI also constrains the input. Convex functions additionally validate
  `args`/`returns` with `convex/values`; see [`convex`](../convex/SKILL.md).
- **Sanitize untrusted text before it reaches an LLM prompt.** Use
  [`sanitizeUntrustedField`](../../../services/platform/lib/shared/sanitize-untrusted-field.ts)
  (strips control / zero-width / bidi-override chars, clamps length) and `wrapUntrusted` from
  [`convex/lib/untrusted_content.ts`](../../../services/platform/convex/lib/untrusted_content.ts) for
  prompt-injection defense.
- **Per-row access is RLS, not hand-rolled checks.** Enforce IDOR/tenant isolation through
  `queryWithRLS`/`mutationWithRLS` — raw `query`/`mutation` bypass it. Owned by
  [`convex`](../convex/SKILL.md).
- **The SAST gate is blocking — fix, don't bypass.** `bun run lint:sast` is a required CI gate
  ([`security.yml`](../../../.github/workflows/security.yml)) that exits non-zero on any
  ERROR/WARNING finding. Suppress a _genuine_ false positive narrowly, never broadly (below).
- **Never weaken the sandbox firewall.** The IP-layer REJECT rules are the hard SSRF boundary and the
  egress entrypoint fails closed — see the sandbox section before editing either service.

## The SAST gate

`bun run lint:sast` runs [`tools/opengrep/run.sh`](../../../tools/opengrep/run.sh) — a pinned Opengrep
(Semgrep CE fork, `v1.22.0`) binary over two configs: the hand-written
[`config.yml`](../../../tools/opengrep/config.yml) (always) and a vendored registry snapshot
[`rules/registry-pinned.yml`](../../../tools/opengrep/rules/registry-pinned.yml). Both are **vendored
and pinned on purpose** so the gate is deterministic — no scan-time registry fetch can drift and fail
an unrelated PR. The run gates on ERROR **and** WARNING. It's wired into `bun run verify` and
pre-commit (`OPENGREP_LOCAL_ONLY=1` there → fast local rules only; the full pack set is the CI gate).

Rule classes the custom `config.yml` enforces (all ERROR):

- **TS/JS:** `eval(...)`, `new Function(...)`, `document.write`/`writeln`, interpolated
  `exec`/`execSync` (shell injection), hardcoded PEM private keys.
- **Python:** `eval`/`exec`, `subprocess(..., shell=True)`, `yaml.load` without `SafeLoader`,
  `requests`/`httpx` `verify=False` (TLS bypass), web-framework `debug=True`.

Refresh the vendored snapshot with **`bun tools/opengrep/vendor-rules.ts`** (re-fetches the pinned
packs — TS/React/Node, OWASP Top Ten, CWE Top 25, XSS, SQLi, command-injection, secrets,
Python/FastAPI, Dockerfile — keeping only ERROR/WARNING rules, ASCII-only). Don't hand-edit the
generated file.

**Suppressing a finding** — only when it's a true false positive, and narrowly:

```ts
// nosemgrep: ts-child-process-shell-injection -- arg is a hardcoded literal, never user input
execSync(`git rev-parse HEAD`);
```

`# nosemgrep:` in Python. Never a file-wide or blanket ignore. Rules that _only ever_ fire as noise
in this codebase are listed (with reasons) in
[`excluded-rules.txt`](../../../tools/opengrep/excluded-rules.txt) — adding to it is a last resort,
not the first move.

## The sandbox SSRF model

Sandboxed user/agent code can make outbound requests, so the egress path is the trust boundary.
[`services/sandbox-egress`](../../../services/sandbox-egress/README.md) runs `tinyproxy` fronted by an
**IP-layer `iptables` firewall**: it REJECTs the cloud metadata endpoint (IMDS, `169.254.169.254` +
link-local) and RFC1918 ranges (`10/8`, `172.16/12`, `192.168/16`, v4 **and** v6), so sandboxed code
can't reach the host network or steal instance credentials. Egress is open at the hostname layer —
the IP firewall is the hard boundary — and the entrypoint **fails closed**: if the rules can't be
installed (missing `iptables`, no `NET_ADMIN`), the proxy refuses to start.
[`services/sandbox-runtime`](../../../services/sandbox-runtime/README.md) REDIRECTs _all_ container
egress through that proxy and binds its VNC/debug endpoints loopback-only.

When editing either service: keep the firewall install ahead of any network use, keep it fail-closed,
and never add a host-network or metadata-reachable path. Container/Dockerfile hardening is
[`docker`](../docker/SKILL.md).

## Doing a security review

For a full adversarial pass over a branch's diff, run the harness **security-review** skill (it walks
the OWASP categories and reports findings) rather than auditing by hand. Pair it with
[`review`](../review/SKILL.md) for correctness and [`verify`](../verify/SKILL.md) to confirm a fix
actually closes the hole on a running stack.

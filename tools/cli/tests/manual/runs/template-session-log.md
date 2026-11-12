# Session log — R\<n\>

> Copy to `/tmp/cli-qa/r<nnnn>/log.md` and tick **here**, never
  in a suite. This file is scratch: it is where the round actually happens, and
  it is the only input the [round record](template.md) needs.

| | |
|---|---|
| **Round** | R\<n\> |
| **Started** | \<YYYY-MM-DD HH:MM TZ\> |
| **SHA** | `<git rev-parse --short HEAD>` |
| **Binary** | \<`tale --version`\> · built from `<short sha>` |
| **Hosts** | \<each host: its role, address, OS and release, runtime version\> |
| **State** | reset — \<time of each reset as you go\> |
| **Origin** | \<the deployment's public address, if a box needs one\> |
| **Tester** | \<name / agent\> |

## Preflight

- [ ] `bun run check` on an untouched tree — result: \<n/n green\>
- [ ] `bun run lint:manual` — green
- [ ] The same `tale --version` on every host
- [ ] Every host at its starting state, and no other writer on it

## Run log

Paste the boxes you mean to run out of the suites, in the order you will run
them, and work down. Conventions:

- `- [x]` — driven, matched the expectation.
- `- [ ]` — not run (leave it; the record's "not reached" section reads these).
- `- [x] … → **R<n>-<k>**` — driven, did not match: file it below and keep going
  unless the [failure policy](../readme.md#failure-policy) says to halt.
- Note anything surprising-but-correct inline; it may belong in
  [`not-a-finding.md`](../reference/not-a-finding.md) at close.

```
### incus-runtime           reset at HH:MM
- [ ] `INC-F<n>` · …
```

## Findings

One line each, cited by box ID:

```
R<n>-<box-id> | severity | surface | repro | expected vs actual | fix (files) | verified by
```

- \<…\>

## Evidence

The command, its whole output and the host's state after it, per finding,
under `/tmp/cli-qa/r<nnnn>/<box-id>/`. List what you captured, so the
record can point at it:

| Finding | Files |
|---|---|
| R\<n\>-1 | `INC-F<n>/command.txt`, `INC-F<n>/output.txt`, `INC-F<n>/host.txt` |

## Output sweep

Every unexpected `error`-level line, in the CLI's output or a service's log,
with the command or the service it came from.
Check each against the known-benign list in
[`not-a-finding.md`](../reference/not-a-finding.md) before filing it.

- \<…\>

## Carry-over

What this round did **not** reach, and why — copied verbatim into the record's
"Not reached" section.

- \<…\>

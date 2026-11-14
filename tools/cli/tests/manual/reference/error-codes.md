# Error-code provocation map

Which failure each command can end in, and how to reach it deliberately. Used
by the suites when a box says "expect exit `<code>`", and as the checklist for
"should this failure even be reachable from here?".

## Exit codes

A command the CLI runs ends in one of these classes
(`ExitCode` in `tools/cli/src/utils/fail.ts`), so a script can branch on the
class. Its failure prints `[ x ] <summary>`, then `Cause:` and a
copy-pasteable `Try:` where it has them.

| Code | Means | How to reach it |
|---|---|---|
| `0` | done | any command that succeeds |
| `1` | any other failure, including a command line the parser refuses before a command runs (an unknown command or flag) | `tale --no-such-flag`: `error: unknown option '--no-such-flag'` |
| `2` | usage: a value the command itself refuses | `tale deploy smoke --url http://127.0.0.1:9 --timeout 0`: `Invalid --timeout "0": expected 1-300 seconds.` |
| `3` | a precondition the operator can fix (no project, a runtime that is down, a busy port) | `tale status` outside a project: `No Tale project found.`, then `Try: tale init` |
| `4` | aborted: Ctrl-C, or a required prompt in a non-interactive shell | in a throwaway project (`tale init --yes`), `tale reset --all </dev/null`: `Cannot prompt ("Are you sure you want to reset?") — this is not an interactive terminal.` |
| `5` | an external dependency failed (a registry, the network, the runtime's daemon) | `tale deploy smoke --url http://127.0.0.1:9` with nothing listening there: every check fails, then `The deployment failed the smoke test.` |

## Refusals a command prints

Each names what is wrong and what to do next, in words an operator can act on.

None recorded yet. A refusal is a row of this table:

| Refusal | How to reach it |
|---|---|

## Must never appear

A stack trace (outside `--verbose`, which adds the cause's own), an unhandled
rejection, a secret, or a raw response body from the runtime, a registry or the
platform: a failure keeps its authored words or a fixed summary, never its
payload (`tools/cli/src/commands/operational-failure.ts`).
There is no repro by definition; any sighting is a finding.

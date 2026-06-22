/**
 * Merge the three author-supplied env layers a sandbox step sees into the single
 * `{ name: value }` map injected into its sandbox. Precedence (later wins):
 *
 *   1. workflowEnv — workflow-level side-table (auto-injected into EVERY step)
 *   2. fileEnv     — the step's file `config.env` (pack-author declarative,
 *                    already `{{...}}`-templated by `resolveStepEnv`)
 *   3. stepEnv     — step-level side-table (operator override for THIS step)
 *
 * So a step value always beats a workflow value (the headline rule), and the
 * operator's UI-configured value beats the pack file's declared default. The
 * merged map is then injected BELOW the per-agent env and broker credentials in
 * `workflow_sandbox_exec.ts`, so a security-critical broker var (e.g.
 * `GITHUB_TOKEN`) still wins — this helper never touches that layer. Pure (no
 * I/O) so it is unit-testable in isolation.
 */
export function mergeSandboxEnv(
  workflowEnv: Record<string, string>,
  fileEnv: Record<string, string>,
  stepEnv: Record<string, string>,
): Record<string, string> {
  return { ...workflowEnv, ...fileEnv, ...stepEnv };
}

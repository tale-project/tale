# AI agent runtime selection worksheet

Complete this worksheet for a workload and deployment, not for an abstract “best agent.” Empty fields are intended for your evidence. Use `documented`, `observed`, `unknown`, or `not applicable` to distinguish evidence states.

## Filled example: select the combination without ranking the model

**Synthetic teaching example. R1, R2, M1, M2, and all results are invented; these are not vendor or Tale test results.** Assume every combination is compatible and has passed the mandatory access and credential checks. The same six cases, source snapshots, skill revision, rubric, and declared operating limits are used, without human repairs.

| Initial-output acceptance | M1 | M2 |
| --- | --- | --- |
| R1 | 3/6 | 5/6 |
| R2 | 5/6 | 4/6 |

Comparing only R1/M1 with R2/M2 cannot identify a model effect. In the assumed full matrix, M2 helps in R1 while M1 does better in R2. Preserve the individual configuration identities.

| Additional assumed evidence | R1/M2 | R2/M1 |
| --- | --- | --- |
| Active preparation and review for six cases | 48 minutes | 30 minutes |
| Covered execution charges | $6 | $6 |
| Mid-task correction check | Updated audience in final brief | Updated audience in final brief |
| Explicit handoff check | Sources verified by next worker | Sources verified by next worker |
| Deadline | Five accepted results within deadline | Five accepted results within deadline |

**Filled decision:** pilot R2/M1 for research briefs, because the observed count is tied while active human effort is lower under these assumptions. This does not identify a generally superior model. Review its failed case and repeat representative trials. Reverse the choice if the apparent time advantage disappears, a mandatory path stops working, or a material failure makes this workload unsuitable. Maintenance and deployment costs remain outside this example.

**When the matrix cannot be completed:** compare compatible deployable setups and explicitly leave component attribution unresolved. Never substitute a different provider or credential path and silently call it the same configuration.

## State the comparison question

| Field | Value |
| --- | --- |
| Select deployable setups, diagnose a component, or both? | |
| Complete configurations compared | |
| Single component varied for diagnostic comparison | |
| Other settings held constant | |
| Compatibility prevents these comparisons | |
| Equal operating constraints: spend, deadline, repair allowance | |
| Tuning budget per candidate | |
| Realized retries / calls / use of tools | |
| Difference that remains confounded | |
| Conclusion the comparison cannot support | |

Equal model names do not imply equal systems. Equal token limits do not automatically imply equal cost or opportunity. Separate actual operation limits from what a diagnostic comparison attempts to hold fixed.

## Work to support

| Field | Value |
| --- | --- |
| Task and intended deliverable | |
| Task starter's role | |
| Reviewer and acceptance criteria | |
| Input types and source locations | |
| Required reads | |
| Required writes, if any | |
| Prohibited actions | |
| Expected steering / interruption needs | |
| Persistence and handoff needs | |
| Data destinations permitted | |
| Cost, time, and capacity limits | |

## Compare the actual setup

| Layer | Candidate A | Candidate B | Evidence / date |
| --- | --- | --- | --- |
| Runtime and version | | | |
| Model and serving provider | | | |
| Credential path; no secret values | | | |
| Gateway / subscription billing coverage | | | |
| Instructions revision | | | |
| Equipped skills and bundle revisions | | | |
| Tool operations and effective permissions | | | |
| MCP capabilities required and available | | | |
| Workspace / isolation scope | | | |
| File collection and retention behavior | | | |
| Hosting / outbound destinations | | | |
| Capacity and queue behavior | | | |
| Recovery / continuation behavior | | | |

Mark each requirement mandatory, useful, or irrelevant. Do not award points for irrelevant features. Record evidence that a mandatory requirement works in the intended deployment; a marketing statement or compatible file format alone does not establish that.

## Small acceptance trial

| Test | Input and expected behavior | Actual observation | Artifact / execution evidence | Decision |
| --- | --- | --- | --- | --- |
| Complete the bounded task | | | | |
| Discover the relevant skill | | | | |
| Follow its distinctive procedure | | | | |
| Avoid unnecessary skill activation | | | | |
| Respect a prohibited operation | | | | |
| Receive a mid-task correction | | | | |
| Continue or restart after interruption | | | | |
| Use permitted files on a later task | | | | |
| Hand off to a different worker explicitly | | | | |
| Explain refusal or missing dependency | | | | |

Preserve artifacts before using a clean test environment. Distinguish file persistence, conversation continuation, and knowledge passed to another agent. Don't treat cancellation as undo. Test recovery using reversible synthetic data.

## Review quality and costs

Use [the evaluation scorecard](T08-evaluation-scorecard.md) for comparable trials. Keep output correctness, human intervention, elapsed time, and measured cost coverage separate. A working model connection does not prove all required tools work; an available skill does not prove it was applied.

For Tale, verify the current [runtime matrix and credential paths](https://docs.tale.dev/platform/agents/harnesses), [project-agent configuration](https://docs.tale.dev/platform/projects/project-agents), and [skill equipment](https://docs.tale.dev/platform/agents/skills). Supported subscription calls bypass Tale gateway metering and caps. Do not assume universal subscription, model, runtime, or MCP compatibility.

## Selection and maintenance

| Item | Decision |
| --- | --- |
| Selected configuration | |
| Workloads it is approved for | |
| Evidence supporting selection | |
| Known limitations / missing observations | |
| Condition that reverses this selection | |
| Extra maintenance effort justified by specialization | |
| Owner of credentials and usage review | |
| Owner of instructions, skills, and tool changes | |
| Known tasks to rerun after changes | |
| Review triggers / next review date | |

Revisit the decision after a relevant runtime, provider, model, skill, tool, or permission change. Preserve earlier trial records as dated evidence; do not silently reinterpret them as tests of a newer configuration.

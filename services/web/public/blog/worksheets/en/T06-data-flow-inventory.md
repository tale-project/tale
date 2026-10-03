# AI deployment data-flow inventory

Copy this worksheet for one specific deployment configuration. Record observed facts separately from intended configuration. “Not observed” means a test did not see a flow; it does not establish that the flow cannot occur. All rows begin unverified.

## Deployment and decision

| Field | Record |
| --- | --- |
| Decision owner and operator | Unassigned |
| Deployment/version/date/timezone | Not recorded |
| Configuration snapshot location, excluding secrets | Not recorded |
| Intended team tasks and data classes | Not agreed |
| Application/inference/embedding locations | Not recorded |
| Required location/access/retention constraints | Not agreed |
| Current model and tool identifiers | Not recorded |
| Pilot task using synthetic inputs | Not selected |

## Filled boundary decision — synthetic

Task: compare public suppliers against an internal requirements brief. Assumed rule: the brief and derived passages must remain inside a controlled environment; public supplier material may be fetched externally. This is an illustrative organizational rule, not a regulation or Tale default.

| Path | Payload classification | Decision | Reason |
| --- | --- | --- | --- |
| Brief to extraction and storage | Internal | Internal services | Derived text still contains the protected material |
| Text to embedding endpoint | Internal | Approved internal endpoint | Index creation is a disclosure path too |
| Mixed brief and public passages to generation | Internal | Internal inference | Public additions do not reclassify the brief |
| Supplier lookup from worker | Public lookup terms only | Public destination allowed for this task | Internal requirements must not be copied into the query |
| Error reporting | Potentially internal | Inspect fields or disable external reporting | Success-path traces do not exercise this route |

The choice changes if the organization permits a particular external processor for the internal payload. Record the rule owner and approved change before changing routing or fallback.

## Reproduce the cost decision — synthetic US dollars

These are invented assumptions, not prices, measured labor, or benchmark results. Scope: incremental inference operation for the same workload. This comparison assumes the organization has approved a particular hosted processor for internal content, so both options satisfy the data boundary. Under the earlier internal-only rule, hosted inference remains ineligible regardless of its estimated cost. Common workspace costs are excluded; add differing licenses, support, networking, storage, and staffing when using the method for a real decision.

Define **N** as distinct initiated jobs, including those that fail or time out. **a** is the fraction yielding an accepted deliverable after the allowed retry/repair policy. Count a deliverable once. **v** includes modeled variable processing, all retries, and review/correction labor per initiated job. **F** includes assigned fixed capacity, operations labor, and recovery provision. Do not double count labor between F and v.

| Input or calculation | Self-operated | Hosted |
| --- | ---: | ---: |
| F per month | $2,600 | $200 |
| Modeled processing/retries per initiated job | $0.10 | $0.80 |
| Modeled review/correction: 2 min × $60/hour per initiated job | $2.00 | $2.00 |
| Total v per initiated job | $2.10 | $2.80 |
| N | 5,000 | 5,000 |
| a | 0.90 | 0.90 |
| Covered cost = F + v × N | $13,100 | $14,200 |
| Accepted deliverables = a × N | 4,500 | 4,500 |
| Covered cost / accepted deliverable | $2.91 | $3.16 |

With equal acceptance and sufficient fixed capacity, the crossover is `(2600 − 200) / (2.80 − 2.10) ≈ 3429` monthly jobs. At N = 1,000, the totals are $4,700 and $3,000. At N = 5,000 but self-operated a = 0.65, its cost is `13100 / 3250 ≈ $4.03` per accepted deliverable. The recommendation reverses. This calculation holds other assumptions fixed; actual rework or added hardware may also change cost.

For your decision, replace each input with an observed figure or a labelled estimate and cite its evidence. Record an uncertainty range; unknown costs are not zero. If a × N is zero, cost per accepted deliverable is undefined: report cost with zero accepted outputs. Never extrapolate beyond tested capacity without changing the cost model.

| Your assumption | Option A | Option B | Evidence/estimate and uncertainty |
| --- | --- | --- | --- |
| Fixed monthly scope and F | Not estimated | Not estimated | Not recorded |
| Variable cost coverage and v | Not estimated | Not estimated | Not recorded |
| N and arrival/concurrency pattern | Not estimated | Not estimated | Not recorded |
| Acceptance rule, retry limit, and a | Not measured | Not measured | Not recorded |
| Peak deadline met at this capacity? | Not tested | Not tested | Not recorded |
| Cost or quality change that reverses choice | Not calculated | Not calculated | Not recorded |

## Recovery dependency exercise — synthetic, not executed

Assume the database is recoverable to 10:05, the file backup to 10:00, and a report was uploaded at 10:03. The restored record could point to missing bytes. A running application is not sufficient acceptance evidence.

Expected response: keep traffic/scheduled actions stopped in the isolated recovery environment, preserve the existing state, and identify a matching object version or a complete coordinated recovery set. If the last usable set is 10:00, explicitly document the later work that must be recovered separately or accepted as lost. Do not assume a newer database, re-indexing, or current application image repairs missing bytes.

| Recovery dependency | Evidence to collect | Status |
| --- | --- | --- |
| Application and knowledge state | Backup IDs and coordinated recovery point | Not collected |
| Original files and generated reports | Object versions and sample file download | Not collected |
| Configuration, keys, gateway state, matching application version | References to protected copies; no key values | Not collected |
| Retained worker state, if required | Separate sandbox workspace recovery plan | Not collected |
| Usable service | Sign-in, old project/file, controlled search and credential checks | Not run |
| Recovery objective | Lost-data interval and elapsed time to accepted service | Not measured |

An isolated drill must avoid production notifications and tool writes. If an earlier action may have completed before failure, reconcile it in the receiving system before retrying.

## Destination inventory

Copy a row when a flow has more than one destination. Store secret references or credential owners, never the credential values, in this worksheet.

| Flow | Actual host/service and operator | Payload | Region/location evidence | Access identity | Retention/backup owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Browser to application | Not recorded | Account and task requests | Not verified | Not recorded | Not recorded | Unverified |
| Application records | Not recorded | Users, tasks, chats, runs | Not verified | Not recorded | Not recorded | Unverified |
| Original/generated files | Not recorded | Source files and deliverables | Not verified | Not recorded | Not recorded | Unverified |
| Knowledge store | Not recorded | Extracted text, embeddings, indexes | Not verified | Not recorded | Not recorded | Unverified |
| Embedding service | Not recorded | Selected source text and queries | Not verified | Not recorded | Not recorded | Unverified |
| Gateway-routed generation service | Not recorded | Prompts, context, tool results | Not verified | Not recorded | Not recorded | Unverified |
| Direct runtime/provider calls, including subscriptions | Not recorded | Prompts, context, tool results outside gateway routing | Not verified | Not recorded | Not recorded | Unverified |
| Sandbox web/tool traffic | Not recorded | URLs, queries, selected content | Not verified | Not recorded | Not recorded | Unverified |
| Backend connectors | Not recorded | Action-specific input/output | Not verified | Not recorded | Not recorded | Unverified |
| Moderation | Not recorded | Text selected for checking | Not verified | Not recorded | Not recorded | Unverified |
| Error reporting/analytics | Not recorded | Enabled event fields | Not verified | Not recorded | Not recorded | Unverified |
| Backups and copies | Not recorded | Coordinated recovery data | Not verified | Not recorded | Not recorded | Unverified |
| Updates/model downloads | Not recorded | Images, packages, model artifacts | Not verified | Not recorded | Not recorded | Unverified |

## Control and observation record

| Field | Record |
| --- | --- |
| Flow under test and executing process | Not recorded |
| Allowed destination and reason | Not recorded |
| Restriction mechanism and configuration | Not recorded |
| Test destination expected to be refused | Not recorded |
| Observation start/end | Not recorded |
| Instrument and evidence location | Not recorded |
| Actual result: allowed/refused/inconclusive | Not assessed |
| What the observation could not see | Not recorded |
| Reviewer and follow-up | Unassigned |

Run tests only on systems you are authorized to inspect, with harmless synthetic requests. Select a controlled destination for refusal tests. Do not send sensitive content merely to demonstrate that an endpoint accepts it.

## Acceptance checks

| ID | Check | Status |
| --- | --- | --- |
| D01 | Verify the actual inference and embedding endpoints used by the selected task | Not run |
| D02 | Verify authentication and reachability from outside the trusted network | Not run |
| D03 | Inspect published container ports and effective firewall behavior | Not run |
| D04 | Test allowed and refused sandbox destinations | Not run |
| D05 | Inspect gateway-routed generation, direct runtime/provider calls, and backend connectors separately from sandbox egress | Not run |
| D06 | Exercise one controlled error to inspect configured reporting fields and destination | Not run |
| D07 | Review moderation and analytics settings, including disabled/enabled states | Not run |
| D08 | Complete an isolated restore and verify old files, configuration, and required secret access | Not run |
| D09 | Inventory update and model-download dependencies | Not run |
| D10 | Repeat a representative workload with expected concurrency and record capacity limits | Not run |

## Operating responsibility

| Responsibility | Owner | Cadence/trigger | Evidence |
| --- | --- | --- | --- |
| Updates and rollback/recovery planning | Unassigned | Not agreed | Not recorded |
| Credential rotation and revocation | Unassigned | Not agreed | Not recorded |
| Capacity and queue monitoring | Unassigned | Not agreed | Not recorded |
| Alert response | Unassigned | Not agreed | Not recorded |
| Off-host and external-store backups | Unassigned | Not agreed | Not recorded |
| Restore drills | Unassigned | Not agreed | Not recorded |
| Destination and configuration review | Unassigned | Not agreed | Not recorded |

## Decision

Record supported tasks/data classes, external services accepted, unresolved risks, required changes, and the next review trigger. Do not label a deployment air-gapped, fully local, or compliant solely because this inventory was completed.

Tale references: [Architecture](https://docs.tale.dev/self-hosted/overview), [Data stores](https://docs.tale.dev/self-hosted/configuration/data-residency), [Hardening](https://docs.tale.dev/self-hosted/operate/security/hardening), [Observability](https://docs.tale.dev/self-hosted/configuration/observability-config), and [Recovery](https://docs.tale.dev/self-hosted/operate/backups-and-restore).

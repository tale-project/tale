# Knowledge acceptance worksheet

Use this worksheet to evaluate a small shared-knowledge collection before expanding it. Copy the file for each evaluation. The examples below are synthetic test material; no test has been run and no outcome is implied.

## Evaluation record

| Field | Record |
| --- | --- |
| Evaluation owner | Unassigned |
| Domain/source owner | Unassigned |
| Deployment and product version | Not recorded |
| Model/provider and retrieval configuration | Not recorded |
| Date and timezone | Not recorded |
| Project and collection identifiers | Not recorded |
| What decision this evaluation supports | Not recorded |
| Freshness requirement and rationale | Not agreed |
| Location of restricted evidence | Not recorded |

## Synthetic source pack

Create ordinary text documents with these statements. Use stable record identifiers as well as filenames; a matching filename does not establish that one upload replaced another.

| ID | Synthetic text | Intended scope |
| --- | --- | --- |
| SRC-01 | “Effective 1 October. Standard support operates Monday through Friday. Weekend coverage requires a separate approved exception.” | Shared reference available to both test users |
| SRC-02 | “Launch proposal, 2 October. Weekend coverage is proposed. Approval remains outstanding.” | Project A only |
| SRC-03 | “Draft announcement, 2 October. We will provide weekend support.” | Project A; intentionally conflicts with authority |
| SRC-04 | “Project B uses the internal label Copper Finch.” | Project B only |
| SRC-05 | “Legacy policy, superseded 1 October. Standard support includes Saturdays.” | Deliberately retained as superseded material |
| SRC-06 | “The synthetic experiment code is Lantern 47.” | Team-restricted library file |

Do not use live confidential policies, personal data, or real customer promises. Add the source owner, effective date, and authority status to each record. Define how a reviewer will decide which source controls a conflict before querying the model.

## Completed reasoning example — synthetic, not an observed test

**Question:** What support coverage can we promise in the launch announcement?

**Source state:** SRC-01 is the effective policy, SRC-02 says the exception is pending, SRC-03 is a draft, SRC-05 is superseded. USER-A may read all four. The intended rule is that an approved exception is required for a weekend promise.

**Constructed candidate:** “Weekend support is confirmed,” citing SRC-03.

| Dimension | Assessment of the packet or candidate | Reason |
| --- | --- | --- |
| Relevance | Relevant | The draft concerns launch coverage |
| Sufficiency of the supplied packet for the question | Sufficient for a bounded weekday/pending answer | SRC-01 and SRC-02 support that qualified answer; no retrieval repair is required merely to avoid a weekend promise |
| Evidence authorizing a weekend promise | Missing | No approving exception is supplied; this does not make the bounded answer unanswerable |
| Faithfulness to draft wording | Repeats the draft's promise | This does not make the promise organizationally approved |
| Authority and currency | Fails the decision rule | An unapproved draft cannot supersede the policy |
| Access for USER-A | Permitted by the synthetic map | Access does not repair the unsupported conclusion |
| Work decision | Withhold the weekend promise; assign an approval-evidence question | Avoid claiming no approval exists anywhere |

**Expected replacement answer:** “The current sources establish weekday support. Weekend coverage is proposed and approval is outstanding in the supplied proposal. Obtain the approved exception before promising weekends.” It should cite SRC-01 and SRC-02.

This is a grading example, not a product result. If the retrieved context is not exposed, record that limitation instead of claiming the model saw all four sources.

**Counterexample:** Add SRC-07: “Approved launch exception, 3 October: weekend coverage is authorized for this launch only,” with an identified authorized owner and Project A scope. Verify that the answer now permits that launch's weekend promise while retaining weekday standard policy. This catches a model or prompt that simply learned to refuse.

## Diagnose and repair one layer

| Evidence found after a bad answer | First repair to investigate | What would challenge the diagnosis? |
| --- | --- | --- |
| Needed source is absent or unreadable | Source preparation/indexing | A completed index and directly retrievable passage |
| Needed source is indexed but absent from supplied passages | Retrieval/context selection | Evidence the passage was supplied to generation |
| Necessary passages are supplied but misinterpreted | Generation/conflict handling | An unresolved source contradiction or authority ambiguity |
| No authoritative answer exists in the collection | Ask the source owner; limit the claim | A newly found, valid authoritative record |
| Restricted content is returned | Access/identity/filtering path | Prior disclosure in conversation; inspect both paths separately |

Change one suspected layer, preserve the original attempt, and rerun the original question plus a paraphrase and contrary case. Do not create duplicate policy uploads as an undocumented repair.

## Access contexts

| Context | Role | Membership | Expected access | Verified directly? |
| --- | --- | --- | --- | --- |
| USER-A | Ordinary non-admin | Project A and restricted test team | SRC-01, SRC-02, SRC-03, SRC-05, SRC-06 | Not checked |
| USER-B | Ordinary non-admin | Project B; outside restricted team | SRC-01, SRC-04, SRC-05 | Not checked |

Adjust this map to the product’s actual permissions. Owners/admins may have broader access, so do not use them as substitutes for either context. Test project chat, organization chat, and equipped agent retrieval separately where applicable. Record prior conversation content; previously disclosed facts can persist in a conversation independently of a new retrieval.

## Required cases and a reversal check

| ID | Action | Acceptance criterion | Status |
| --- | --- | --- | --- |
| K01 | Ask USER-A which days standard support operates and request a citation | The answer matches SRC-01 and the cited passage supports it | Not run |
| K02 | Ask both users for the experiment code | USER-B receives no restricted code, title, snippet, or revealing citation | Not run |
| K03 | Ask from Project A about Project B’s internal label | No unauthorized Project B material appears | Not run |
| K04 | Upload a separate supported file without a completed index; ask for its contents through search | Record the actual search result and indexing state; do not describe stored bytes as indexed | Not run |
| K05 | Ask about support with SRC-01 and SRC-05 present | The answer identifies the effective source and does not silently use superseded guidance | Not run |
| K06 | Add and then delete a synthetic file in a supported sync source | Record when the mirror and future retrieval reflect deletion, against the agreed freshness requirement | Not run |
| K07 | Ask what coverage may be promised for the launch | The answer distinguishes policy, proposal, and unsupported announcement text | Not run |
| K08 | Ask for the approved launch budget, which none of the sources establishes | The answer identifies the missing evidence rather than inventing an amount | Not run |
| K09 | Add the approved SRC-07 exception described above and repeat K07 | The conclusion changes for the specified launch without changing standard policy | Not run |

For K06, verify that the chosen connector and selection support synchronization. A one-time import does not imply ongoing changes. Run a separate membership-change check alongside K02 if permission synchronization is in scope.

## Result record — copy once per attempt

| Field | Record |
| --- | --- |
| Case and attempt ID | Not recorded |
| Test user and actual effective access | Not recorded |
| Context: organization/project/agent tools | Not recorded |
| Exact question | Not recorded |
| Original/source change time | Not recorded |
| Ingestion completion and indexing status/time | Not recorded |
| Query time | Not recorded |
| Source IDs and revisions expected | Not recorded |
| Full answer and citation evidence location | Not recorded |
| Retrieved context captured, or unavailable? | Not recorded |
| Relevance / sufficiency / faithfulness / authority assessments | Not reviewed |
| Source-owner decision needed? | Not assessed |
| Citation supports each material claim? | Not reviewed |
| Unauthorized content, titles, or references present? | Not reviewed |
| Actual downstream task impact | Not assessed |
| Verdict: pass/fail/inconclusive | Not assessed |
| Reason and follow-up owner | Not assigned |

Use **inconclusive** when the source state, access context, or evidence is insufficient to judge. Do not count an inconclusive attempt as a pass. Preserve failed attempts and distinguish repeated trials from distinct cases.

## Decision and maintenance

| Decision | Record |
| --- | --- |
| Accepted tasks and source scopes | Not decided |
| Unresolved failures and responsible owners | Not decided |
| Changes required before expanding access | Not decided |
| Evidence reviewed by | Unassigned |
| Next review date or triggering change | Not agreed |

Report answerable-case quality separately from appropriate abstention on cases with missing evidence. A refusal on an answerable case is not a success. Keep access violations separate from averages. Record valid failures, timeouts, and inconclusive attempts; explain denominators before reporting any rate.

Re-run affected cases after source, access, connector, model, or retrieval changes. Consult [Tale Knowledge](https://docs.tale.dev/platform/knowledge/overview), [Documents](https://docs.tale.dev/platform/knowledge/documents), and [Project files](https://docs.tale.dev/platform/projects/manage-files) for current product behavior.

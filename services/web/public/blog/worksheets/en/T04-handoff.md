# Agent and team handoff

Copy this record when work changes session, worker, or owner. Write the current state, not a transcript summary. Use accessible artifact locations; never place credential values in the handoff. The receiver completes the final section before continuing dependent work.


## Filled excerpt — synthetic handoff H-04

This invented record demonstrates selective reuse after a brief change. It does not report an actual restart or verified vendor capability.

| Handoff field | Filled example |
| --- | --- |
| Current authoritative goal | Brief B3: compare candidates for 50 people with required single sign-on |
| Superseded premise | Brief B2 concerned a five-person team |
| Retain | Source register r4 as an index, plus supported feature notes with claim-level references |
| Invalidate | Recommendation r2 and the five-seat cost estimate no longer answer B3 |
| Blocking evidence | Applicable plan terms and required sign-on capability remain unverified |
| Next useful action | Open the capability and plan sources for the existing candidates, then assess B3 eligibility and recalculate cost |
| Stop condition | Required evidence is inaccessible, contradictory, or insufficient; ask the project owner rather than guessing |
| Expansion condition | Consider more vendors if the current candidates cannot satisfy B3; do not expand before checking them |

The receiver first reads B3 from the authoritative task record and opens the named artifacts. A recent file timestamp does not restore the old recommendation's validity. Keep the historical work and identify which conclusions require rechecking; retaining a source index does not establish that its claims are current.

## Identity and current goal

| Field | Value |
| --- | --- |
| Handoff identifier and revision | [Stable ID and revision] |
| Related project/task/run | [Identifiers and locations] |
| Prepared by and at | [Worker, timestamp, timezone] |
| Intended receiver | [Person or agent] |
| Accountable person | [Name/role] |
| Current status | [In progress / blocked / ready for review / accepted] |
| Goal | [Outcome and decision it supports] |
| Scope or brief revision | [Current authoritative brief] |

**Next useful action:** [One concrete action and its prerequisite.]

**Stop if:** [A condition that requires a new decision instead of continuing.]

## Completed and incomplete work

| Work item | State | Evidence | Remaining action |
| --- | --- | --- | --- |
| [Item] | [Verified complete / attempted / not started] | [Artifact, observation, check] | [Next step or none] |

Keep attempted work separate from confirmed results. If a check was not performed, say so.

## Artifact register

| Artifact | Accessible location | Revision/date | Purpose and status | Access or retention limit |
| --- | --- | --- | --- | --- |
| [Artifact] | [Exact location] | [Revision/date] | [Working / proposed / accepted / superseded] | [Known limit or unknown] |

Authoritative deliverable: [Artifact and revision, or no accepted deliverable yet].

Material to preserve outside the working environment: [Artifacts and accountable owner].

## Decisions and evidence

| Decision or conclusion | Evidence | Status | Who may resolve or change it? |
| --- | --- | --- | --- |
| [Decision] | [Source and relevant passage/location] | [Accepted / proposed / uncertain] | [Owner] |

- Source precedence: [Which references govern which facts]
- Conflicting or stale evidence: [Conflict, impact, required check]
- Rejected approach and reason: [Only decisions relevant to future work]
- Change since the previous handoff: [What changed and what it invalidates]

## Validity and selective reuse

| Consequential conclusion or artifact | Depends on | Still valid under current brief? | Required recheck or disposition |
| --- | --- | --- | --- |
| [Recommendation, calculation, or claim] | [Brief revision, source, assumption, access condition] | [Yes / no / unknown with reason] | [Retain / recheck affected part / supersede / block] |

- Current authoritative goal was read from: [Location and revision, not merely the handoff's assertion]
- Source change requiring recheck: [Claim type and trigger; avoid one expiry rule for all evidence]
- Historical evidence retained as historical: [Artifacts and the limited claim they establish]
- Provenance too weak for selective reuse: [What requires a broader recheck and why]

## Open questions and blockers

| Question or blocker | Why it matters | Decision owner | Work that may continue |
| --- | --- | --- | --- |
| [Question] | [Dependent outcome] | [Person/role] | [Named step or none] |

## External actions and uncertain effects

| Attempted operation | Identifier and destination | Acknowledgement | Observed effect | Check before retry |
| --- | --- | --- | --- | --- |
| [Operation, or no external actions] | [Identifier] | [Received / missing] | [Confirmed / unknown] | [Verification and owner] |

A missing response does not establish that an operation failed. Resolve uncertain effects before repeating a consequential action.

- Authoritative effect/status lookup: [Service, identifier, access, result; note search/index limitations]
- Retry protection, if applicable: [Receiving service's actual contract and reference]
- Idempotency key scope, parameter binding, and retention: [Verified details, or unknown]
- Evidence permitting retry: [Confirmed no-effect failure, or an applicable documented idempotent retry contract]
- Changed intent or expired retry protection: [Escalation owner; do not reuse a key by assumption]

A local identifier alone does not make an external operation idempotent. Keep proposed, attempted, and confirmed effects distinct.

## Context and execution needed next

- Required project references and instructions: [Locations]
- Necessary tools and permissions: [Names and scope; no secrets]
- Relevant runtime/configuration: [If continuation depends on it]
- Setup or restart procedure already verified: [Procedure and observation date, or unverified]
- Known workspace or conversation limitation: [Specific limit]
- Acceptance criteria for the remaining result: [Observable checks]

## Receiver acceptance

- Receiver and timestamp: [Values]
- Current brief and status confirmed: [Yes/no; differences]
- Required artifacts opened: [List; unreadable items]
- Versions and source freshness checked: [Findings]
- Superseded conclusion identified without discarding unaffected evidence: [Artifact and reasoning]
- Outstanding decisions understood: [Question IDs and owners]
- Uncertain external effects reconciled: [Outcome or blocking issue]
- Next action agreed: [Action and boundary]
- Handoff status: [Accepted / missing information / outdated]

Record new findings in the task's shared record and identify superseded handoffs. Accepting the handoff confirms readiness to continue; it does not accept an unfinished deliverable.

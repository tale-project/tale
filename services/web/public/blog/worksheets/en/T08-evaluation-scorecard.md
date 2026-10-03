# AI agent evaluation scorecard

Copy this template for one comparison. Blank cells are intentional: enter observations, not sample results. Use `unknown` for missing measurements and `not applicable` only with a reason. A recorded zero means a measured zero.

## Filled example: the cheaper run has the dearer accepted result

**Synthetic teaching example. All counts, charges, times, and labor rates below are assumed. No agent was run to produce these figures.** Two configurations receive the same six cases, each run twice from clean conditions, with one repair round allowed. There are 12 valid started trials per configuration, six distinct cases, no invalid tests, no ungraded outcomes, no start failures, and no prohibited effects. Human time includes all preparation, supervision, review, and repair across the cohort, including failed trials.

| Measure | Configuration A | Configuration B |
| --- | --- | --- |
| Valid started trials N | 12 | 12 |
| First-pass accepted F | 8 | 10 |
| Accepted within repair allowance A, including first-pass | 10 | 11 |
| Final unaccepted trials | 2 | 1 |
| First-pass acceptance F/N | 66.7% | 83.3% |
| Acceptance with permitted assistance A/N | 83.3% | 91.7% |
| Covered model and tool charges | $6 | $18 |
| Human work across cohort | 180 minutes = 3 hours | 120 minutes = 2 hours |
| Assumed hourly rate | $60 | $60 |
| Estimated human cost | $180 | $120 |
| Estimated covered-cost subtotal | $186 | $138 |
| Subtotal per accepted deliverable | $18.60 | $12.55, rounded |

Infrastructure, subscriptions, and deployment overhead are unmeasured, not zero. This is an estimated covered-cost subtotal, not a full-cost or measured-total claim. No delivery-time results are assumed here; passing the delivery requirement is an additional condition for the decision.

**Calculation:** A: `(6 + 3 × 60) / 10 = 18.60`. B: `(18 + 2 × 60) / 11 = 12.545...`. With hourly rate `r`, the comparison is `(6 + 3r)/10` versus `(18 + 2r)/11`. Equality requires `66 + 33r = 180 + 20r`, so `r = 114/13`, approximately `$8.77/hour`. Other missing costs can move the crossover.

**Filled decision:** advance B to a limited supervised pilot if its remaining failure has acceptable severity and it meets the deadline. It has a lower covered ratio above the crossover labor rate under these assumptions. Inspect individual failures and repeat representative cases before generalizing. Below the crossover, A has the lower covered ratio; a disqualifying effect would override either economic advantage.

## Calibrate the reviewer

Use deliberately contrasting outputs before grading candidate configurations. Have qualified reviewers label them against the source evidence, reconcile disagreements, and freeze the rubric. A model judge can assist but its explanations need checking too.

| Calibration item | Expected distinction | Actual judgment / evidence | Change needed |
| --- | --- | --- | --- |
| Concise correct artifact | Pass despite plain style | | |
| Fluent artifact changes source meaning | Material failure despite polished prose | | |
| Correct declaration of missing information | Do not reward fabricated completeness | | |
| Harmless style defect | Separate preference from disqualifying error | | |
| Same pair in reversed order | Investigate a changed preference | | |

Audit some accepted outputs, not only rejected ones, to look for false passes. Keep calibration artifacts separate from the held-out task cases used for final evaluation.

## Evaluation contract

| Field | Value |
| --- | --- |
| Decision this evaluation supports | |
| Workload and intended users | |
| Evaluation owner / reviewer | |
| Evaluation period and time zone | |
| Task-set revision and input snapshot | |
| Development cases / held-out cases | |
| Candidate configurations | |
| Distinct case count / trials per case / total trials | |
| Repeatability question and repetition plan | |
| Grading method / calibration record | |
| Permitted assistance | |
| Maximum repair rounds / time / spend | |
| Timeout and refusal classification | |
| Conditions that invalidate a test | |
| Disqualifying boundary failures | |
| Acceptance thresholds chosen before runs | |

An independent trial starts from equivalent initial conditions. Repairs belong to that trial; do not count each repair as a new accepted deliverable. Failed outputs stay in the cohort. Track an invalid test separately with its reason and cost; apply exclusion rules consistently across candidates. Report operational start failures separately from output quality, without silently dropping them from the reader's view.

## Configuration record

| Configuration ID | Runtime/version | Model/provider | Instructions revision | Skills/revisions | Tools/access | Role of starter | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |

Record credential type and metering boundary; never put a secret value in the scorecard. Preserve the relevant provider/model identifiers and configuration date even when exact versions are unavailable.

## Acceptance rubric

| Criterion | Mandatory or preference | Evidence to inspect | Pass condition | Disqualifying? |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

Judge artifacts against the frozen rubric. Use execution evidence when an action or prohibition matters. A later repair does not erase a prohibited effect. Disclose grading disagreements and their resolution. Keep the first-pass result separate from any accepted assisted outcome.

## Blank trial log

| Trial ID | Case ID | Configuration | Initial result accepted? | Final assisted result accepted? | Repair rounds | Boundary failure | Artifact / verdict evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

Accepted values: `yes`, `no`, or `ungraded`. Do not treat `ungraded` as a pass. Keep timeouts, cancelled trials, and start failures named rather than folded into a convenient catch-all.

## Case coverage and consistency

| Case ID | Task family / difficulty | Configuration | Valid repetitions | First-pass verdict sequence | Repeated failure pattern |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |

Report distinct cases and repetitions separately. A best-of-several success and an all-repetitions success answer different questions; state which supports your operating plan. Repeated cases do not establish coverage of new task families. Do not infer `p^k` from a pooled acceptance rate without the required independence and stable-probability assumptions.

## Timing and effort

| Trial ID | Submitted at | Execution began | Initial output ready | Accepted at / terminal stop | Preparation min | Supervision min | Review min | Human repair min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

Use a single time zone. Measure human working intervals; don't count passive waiting as labor. Record all contributors without double-counting one person's overlapping intervals. Parallel agent durations are not additive elapsed time. For an unaccepted trial, retain its terminal duration and reason but do not invent an acceptance timestamp.

## Cost coverage

| Trial/cohort ID | Category | Amount | Currency | Observed / estimated / unknown | Evidence or allocation rule | Coverage limitation |
| --- | --- | --- | --- | --- | --- | --- |
| | Model charges | | | | | |
| | Tool/service charges | | | | | |
| | Subscription allocation | | | | | |
| | Infrastructure allocation | | | | | |
| | Human labor | | | | | |
| | Other | | | | | |

Do not double-count the same provider charge in a gateway record and an invoice. Use one currency for totals and disclose conversion dates/rates. An unknown category remains unknown; a provider subscription allocation is not a measured per-run charge. Tale's recorded usage is not a complete invoice or guaranteed task-level total. Read [usage analytics](https://docs.tale.dev/platform/admin/governance/usage-analytics) and [runtime credential paths](https://docs.tale.dev/platform/agents/harnesses).

## Formulas

Let `N` be all valid started trials in the declared cohort, including trials that time out or return no output; grade those as failures. Let `F` be trials accepted on the initial output and `A` be all trials accepted within the allowed repair process, including first-pass acceptances with zero repair rounds. Report invalid tests and any still-ungraded trials separately; resolve missing grades before comparing acceptance rates. Report operational failures by reason without removing valid failed trials from `N`.

- First-pass acceptance = `F / N`.
- Acceptance with permitted assistance = `A / N`.
- Human hours = `(preparation + supervision + review + repair minutes) / 60`, summed across the cohort, including failures.
- Estimated human cost = `sum(each contributor's measured hours × disclosed hourly rate)`.
- Estimated cohort cost = `nonduplicated observed charges + disclosed allocations + estimated human cost`.
- Estimated cost per accepted deliverable = `estimated cohort cost / A`.
- Human hours per accepted deliverable = `cohort human hours / A`.
- Accepted trial elapsed time = `accepted timestamp − submission timestamp`.
- Queue time, when observable = `execution-start timestamp − submission timestamp`.

If `N = 0`, both acceptance ratios are **undefined**, not zero. If `A = 0`, both per-accepted-deliverable ratios are **undefined**; show cohort spend/effort and zero accepted deliverables. With material unknown costs, name the ratio “estimated covered-cost subtotal per accepted deliverable” when it includes allocations or labor estimates, and disclose omissions. Reserve “measured subtotal” for observed charges only; do not label it full cost. Report acceptance-time summaries only for accepted trials alongside the failure/timeout counts. Never use a fast-failure duration as a fast successful delivery.

## Decision record

| Item | Finding |
| --- | --- |
| Observed strengths by task type | |
| Failure patterns and severities | |
| Review effort / delivery-time tradeoff | |
| Cost coverage and estimation sensitivity | |
| Conditions supported by this evidence | |
| Conditions not tested | |
| Observed availability / start-failure reasons | |
| Condition that would reverse the decision | |
| Selected configuration / narrower pilot / no rollout | |
| Owner and next review trigger | |

Keep task artifacts and verdict evidence with the record. A single comparison supports a bounded decision, not a universal ranking of models or runtimes.

# Workflow and agent decision worksheet

Use this worksheet before selecting a workflow, an agent, or a hybrid. Complete the process and acceptance sections first. Record unknowns as unknown; do not convert missing measurements into zero.


## Filled excerpt — synthetic feedback report

These invented inputs demonstrate a design decision, not a benchmark or observed model result.

| Decision field | Filled example |
| --- | --- |
| Counting invariant | Keep one row per feedback identifier under the owner's agreed rule; 22 rows minus two repeated identifiers leaves 20 distinct feedback items |
| Prior-month counts | Setup 4, billing 6, reliability 5, other 5: total 20 |
| Current-month counts | Setup 8, billing 5, reliability 4, other 3: total 20 |
| Accepted calculation | Setup's share of recorded feedback rises from 20% to 40%, an increase of 20 percentage points |
| Unsupported interpretation | “40% of customers struggle with setup” uses a customer denominator the export does not establish |
| Rejected cause | Two sign-on comments and a same-month release note do not establish that the release caused the increase |
| Selected design | Defined validation/counting steps, followed by a bounded investigation when discoveries determine the next permitted source to inspect |
| Protected output | Preserve the accepted counts and original records; keep proposed topic annotations separate |

The investigation can recommend an invitation-instruction audit from the three invitation-related records without declaring one common cause. A count-only request needs no agent; a complete short evidence packet may need only one model step. Conflicting versions of one identifier require an owner-defined exception rule before accepting the counts.

## Process definition

- Process and owner: [Name and accountable person]
- Trigger or start request: [What starts the work]
- Inputs and authoritative sources: [Locations, formats, scope]
- Desired output: [Artifact or observable effect]
- Current method: [How the work is performed today]
- Frequency and variability: [Known evidence, or unknown]
- Consequences of a wrong result: [Specific impact]
- Authorized external effects: [Exact scope, or none]
- Human decisions retained: [Decision, owner, required evidence]

## Break the work into steps

| Step | Required input | Who chooses the next action? | Proposed implementation | Verification |
| --- | --- | --- | --- | --- |
| [Step] | [Input] | [Rule / model / person] | [Defined step / one model call / agent / person] | [Observable check] |

## Preserve the rules around interpretation

| Invariant or definition | Authority | Who may change it? | What must be recomputed or reapproved after change? |
| --- | --- | --- | --- |
| [Counting unit, duplicate rule, source scope, or required control] | [Owner and rule revision] | [Named authority] | [Affected calculations, conclusions, or actions] |

- Denominator and population: [What the reported share counts; what it cannot establish]
- Original records and excluded-row record: [Locations and versions]
- Proposed annotations kept separately: [Location; approval needed before changing official categories]
- Model output validation: [Structural checks versus substantive evidence checks]
- Interpretation that would exceed the evidence: [A concrete tempting but unsupported conclusion]

For each proposed agent step, answer:

- What uncertainty requires investigation? [Answer]
- Which tools may it choose? [Named tools and bounds]
- What structured result or artifact must it return? [Contract]
- Which claims need supporting evidence? [Criteria]
- What must cause a stop or a question? [Conditions]
- Which simpler implementation was considered? [Alternative and reason]
- What discovery would determine the next tool or source? [If there is none, reconsider whether one model call suffices]
- What would reverse the choice to use an agent? [Stable rule, complete packet, unavailable verification, or measured burden]

## Candidate designs

| Candidate | Description | Expected advantage to test | Additional burden to measure |
| --- | --- | --- | --- |
| Defined workflow | [Steps and branches] | [Hypothesis] | [Exceptions/maintenance] |
| Bounded agent | [Goal, tools, limits] | [Hypothesis] | [Review/variability/cost] |
| Hybrid | [Fixed boundary around agent work] | [Hypothesis] | [Integration/validation] |

Do not fill these columns with assumed results. A candidate can be ruled out before testing when its necessary input, access, or verification is unavailable; record that reason.

## Acceptance and exception cases

| Case ID | Input or condition | Required outcome | Evidence to inspect | Actual result |
| --- | --- | --- | --- | --- |
| C01 | [Representative complete input] | [Expected result] | [Check] | [Not run / observation] |
| C02 | [Missing required input] | [Explicit handling] | [Check] | [Not run / observation] |
| C03 | [Conflicting evidence] | [Preserve conflict] | [Check] | [Not run / observation] |
| C04 | [Unavailable tool/reference] | [Bounded failure or escalation] | [Check] | [Not run / observation] |
| C05 | [Repeated request] | [Agreed duplicate behavior] | [Check] | [Not run / observation] |

Required criteria for acceptance: [List observable conditions].

Disqualifying outcome: [Specific failure requiring redesign or stopping the pilot].

## Trial record

- Candidate and configuration revision: [Identifier]
- Model/runtime/tools: [Exact configuration]
- Source and input versions: [Identifiers]
- Date, operator, and review owner: [Values]
- Cases run and repetitions: [Actual sample]
- Accepted outputs: [Count with definition]
- First-pass acceptance versus acceptance after repair: [Separate counts and denominators]
- Repeated-case record: [Case, reset state, configuration, every valid attempt and outcome]
- Eventual success versus consistent acceptance: [Separate observations; do not hide failed attempts]
- Revisions and failures: [Count and reasons]
- Completion time: [Observed scope and units]
- Human preparation, review, and correction effort: [Measured or unmeasured]
- Model/tool/infrastructure cost: [Measured components and excluded components]
- External effects: [Observed record]
- Limitations of this trial: [Sample, coverage, missing measurements]

Preserve failed and timed-out valid attempts. Repeated trials on a small sample are diagnostic evidence, not a general reliability guarantee. Do not assume independence between failures or infer a whole-process success rate by multiplying step rates without justification.

## Decision and revisit condition

Selected design: [Candidate or continue current method].

Evidence for selection: [Specific observations against the criteria].

Remaining uncertainty: [What the trial cannot establish].

Owner and next bounded step: [Person and action].

Revisit when: [Input changes, failure threshold, capability change, or review date].

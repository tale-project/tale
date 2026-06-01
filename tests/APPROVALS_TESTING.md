# Approvals Testing Guide (AI-Directed)

> **Purpose**: Exercise the approval workflow — how AI-proposed write actions surface for human review, the pending/approved/rejected lifecycle, and the confidence display — and collect defects in Issues Found. Approvals are the gate that keeps an agent's write operations from applying without a human in the loop.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. To generate an approval, ask the chat agent to perform a write (e.g. "update customer X's locale") so a pending approval is raised; then open `/dashboard/{id}/approvals`.

> **AI Instructions**: Run in order; one finding per defect with a screenshot. If you cannot raise a real approval (no provider configured), still test the list, empty state, and tab filters, and note "no data" on the action tests.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/approvals
```

## Functional tests

| ID  | Test                 | Steps                                                    | Expected                                                              |
| --- | -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| F1  | Approvals list loads | Open approvals                                           | Pending list (or empty state); status tabs render                     |
| F2  | Pending item detail  | Open a pending approval                                  | Shows the proposed action, target resource, and confidence percentage |
| F3  | Approve              | Approve a pending item                                   | State → Approved; the underlying write now applies; audited           |
| F4  | Reject               | Reject a pending item                                    | State → Rejected; the write does NOT apply; audited                   |
| F5  | Types render         | View a "Review Reply" and a "Recommend Product" approval | Each type shows its relevant payload                                  |
| F6  | Verify-approval tool | In chat, agent calls `verify_approval` after raising one | Agent waits for the human decision before continuing                  |

## Boundary & state tests

| ID  | Test                    | Steps                                           | Expected                                              |
| --- | ----------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| B1  | Double-decision guard   | Approve, then try to act on the same item again | Second action is a no-op / disabled (already decided) |
| B2  | Confidence bounds       | Inspect confidence values                       | Always 0–100%; no NaN/blank                           |
| B3  | Rejected stays rejected | Reject, refresh                                 | Item remains Rejected; write never applied            |
| B4  | Permission              | As a role without approve rights, open an item  | Approve/Reject hidden or disabled                     |

## API / integration tests

| ID  | Test             | Steps                          | Expected                                  |
| --- | ---------------- | ------------------------------ | ----------------------------------------- |
| A1  | Approval audited | Approve, then check Audit logs | An audit row records the decision + actor |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check                      | Expected                                             |
| --- | -------------------------- | ---------------------------------------------------- |
| X1  | Keyboard decide            | Approve/Reject reachable + operable by keyboard      |
| X2  | Confidence not colour-only | Confidence conveyed by text/number, not colour alone |
| X3  | Status announced           | Decision result is announced to assistive tech       |

## Performance tests

| ID  | Metric              | Target                       |
| --- | ------------------- | ---------------------------- |
| P1  | List load           | < 1.5 s                      |
| P2  | Decision round-trip | < 1.5 s to reflect new state |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | ---------- |
|     |         |            |          |             |            |

## Test summary

```
Module: Approvals
Functional: ___/6   Boundary: ___/4   API: ___/1   A11y: ___/3   Perf: ___/2
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```

---
name: testing
description: How testing works in the Tale monorepo — Vitest unit/component tests, Testing Library, vitest-axe a11y blocks, Playwright e2e, the test file layout, and the commands. Read before writing or changing a test, adding an e2e spec, debugging a flaky test, or choosing where a test file goes.
---

# testing

The conventions for tests across the repo: Vitest for unit/component (co-located), Testing Library
for DOM, vitest-axe for component a11y, and Playwright for e2e. Component-a11y mechanics overlap with
[`ui-components`](../ui-components/SKILL.md) and [`react`](../react/SKILL.md); driving the real app in
a browser by hand is [`browser-qa`](../browser-qa/SKILL.md); perf-sensitive timing lives in
[`performance`](../performance/SKILL.md).

## Where a test file goes

- **Co-located `*.test.ts(x)` next to the source** is the default — 364 of them under
  `services/platform/{app,lib}` alone. No `__tests__/` directories anywhere (verified — zero exist).
- **Workspace-root `tests/`** is only for what can't co-locate:
  - [`services/platform/tests/e2e/`](../../../services/platform/tests/e2e/) — Playwright `*.spec.ts`
    (`specs/`, `helpers/`, owned by [`playwright.config.ts`](../../../services/platform/playwright.config.ts)),
    built on the shared `@tale/e2e` factory in [`packages/e2e`](../../../packages/e2e/).
  - [`tests/integration/`](../../../services/platform/tests/integration/) — out-of-process
    Bun suites named `*-test.ts`, run directly (`bun services/platform/tests/integration/<name>.ts`,
    or the root `docker:test*` scripts), **not** by Vitest.
  - `tests/manual/` — human/AI QA playbooks (see [`browser-qa`](../browser-qa/SKILL.md)); `tests/stress/`, `tests/pii/`.
- **Naming is the dispatcher:** `*.test.ts(x)` → Vitest, `*.spec.ts` → Playwright, `*-test.ts` →
  directly-run Bun. Pick the suffix that matches the runner, never mix.

## The rules

- **AAA + query by role/label, never test-id.** Arrange–Act–Assert; locate with
  `getByRole`/`getByLabelText` (accessible-name queries double as a11y coverage); drive interaction
  with `userEvent`, not `fireEvent`. Use the wrapped `render` from `@/tests/utils/render` (it injects
  the `AppShell`/i18n providers and returns a `userEvent` `user`).
- **Every UI component has an `accessibility` describe block** calling `checkAccessibility()` — the
  vitest-axe helper ([`packages/ui/tests/utils/a11y.ts`](../../../packages/ui/tests/utils/a11y.ts) for
  package components, [`services/platform/tests/utils/a11y.ts`](../../../services/platform/tests/utils/a11y.ts)
  for app). Reviewer-caught; it's the house pattern across `packages/ui`.
- **Never mock a react-query/Convex hook with a fresh object per render.** Returning a new reference
  each render retriggers effects → an infinite render loop that OOMs the worker. Hoist the mock value
  to a stable reference. (Real incident — see project memory.)
- **e2e: locate by role + i18n label, never CSS.** Resolve every visible string through
  `t('namespace.key')` ([`helpers/i18n.ts`](../../../services/platform/tests/e2e/helpers/i18n.ts),
  reads `services/platform/messages/en.json`); a literal `'Save'` is a bug. Use the named `TIMEOUT.*`
  budget, not millisecond literals. Read the e2e
  [`AGENTS.md`](../../../services/platform/tests/e2e/AGENTS.md) before adding a spec — it is the
  authoring contract (fixture choice, helpers, cleanup-by-id).
- **e2e waits on authoritative state, not text.** A chat turn is done when the Send⇄Stop toggle flips
  (`waitForReplyComplete`), not when reply text appears; a save is confirmed by `reloadAndSettle`,
  never the toast. Per-worker isolated orgs + a mock LLM (`@tale/mocks`, port 4141) make canned
  content deterministic — gate any LLM-content assertion behind `isMockLlmMode()`.

## Gotchas

- **`--project server` Vitest tests are timing-sensitive** (fake timers / `Date.now`) and flake when
  concurrent turbo jobs starve the CPU. For a real verdict run the server suite alone:
  `bun run --filter @tale/platform test`. Don't tail-truncate a failing run — you lose the Failed
  Tests detail.

## Patterns

A minimal co-located component test — accessibility block first, then behavior
([`packages/ui/src/components/forms/input.test.tsx`](../../../packages/ui/src/components/forms/input.test.tsx)):

```tsx
import { describe, it, expect } from 'vitest';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';
import { Input } from './input';

describe('Input', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Input aria-label="Email" type="email" />);
      await checkAccessibility(container);
    });
  });
});
```

An e2e locator — role + resolved i18n label, never a CSS selector
([`specs/agents.spec.ts`](../../../services/platform/tests/e2e/specs/agents.spec.ts)):

```ts
import { test, expect } from '../helpers/fixtures'; // signed-in `org` fixture
import { t } from '../helpers/i18n';
import { TIMEOUT } from '../helpers/env';

await page
  .getByRole('button', { name: t('settings.agents.createAgent') })
  .click();
await expect(continueButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
```

## Commands

```bash
bun run --filter @tale/platform test     # iterate one workspace (server+pii projects)
bun run check                            # format + lint + typecheck + test, all workspaces
bun run --filter @tale/platform test:ui  # Storybook Vitest + addon-a11y (vitest.ui.config.ts)
bun run --filter @tale/platform test:e2e # Playwright; boots its own stack + mock LLM
bun run --filter @tale/platform test:coverage  # v8 coverage
```

Need to confirm a fix actually works in the running app, not just green tests? That's
[`verify`](../verify/SKILL.md) / [`browser-qa`](../browser-qa/SKILL.md).

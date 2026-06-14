import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Governance section breadth coverage. The existing `governance-settings`
 * spec owns the Policies & limits save flow (the voice-output switch); this
 * spec covers every OTHER governance page:
 *
 *  (a) a parametrized "page loads + renders its primary section" smoke for each
 *      leaf route under `/dashboard/$id/settings/governance/*` (including the
 *      two redirecting entry points — `audit-logs` → `logs` and the index →
 *      `content-models`). Each case asserts a real, page-specific i18n heading
 *      is visible after any skeleton settles. Headings render as semantic
 *      heading elements (PageSection/SettingsSection → `<h2>`, the usage/
 *      feedback pages → `<h3>`), so `getByRole('heading')` resolves them.
 *
 *  (b) one extra safe save/toggle+restore flow on the Guardrails page — the
 *      Content-safety enable switch autosaves on toggle (toast → reload →
 *      restore), distinct from the Policies & limits switch the other spec
 *      drives.
 *
 * Read-only by construction in (a): navigation + a visibility assertion mutate
 * nothing, so the shared backend/owner stay pristine. (b) captures the initial
 * switch state and restores it at the end.
 */

const GOVERNANCE_BASE = (organizationId: string) =>
  `/dashboard/${organizationId}/settings/governance`;

interface GovernancePageCase {
  /** Leaf segment of the route under `.../settings/governance/`. */
  slug: string;
  /** i18n key of a heading rendered on the page once it settles. */
  headingKey: string;
  /**
   * When the slug redirects, the heading lives on the destination page. Recorded
   * only for documentation/readability — the assertion already targets it.
   */
  note?: string;
}

// Every governance leaf route EXCEPT `policies-limits` (owned by
// `governance-settings.spec.ts`). The heading keys come from each page's
// primary component:
//  - content-models       → SystemPromptEditor's PageSection title
//  - usage                → UsageMetricsPage's <h3>
//  - guardrails           → GuardrailsOverview's PageSection title
//  - run-code-policy       → the page's first PageSection title
//  - security-monitoring  → LoginPolicyEditor's PageSection title
//  - trash                → TrashPage's PageSection title
//  - legal-hold           → ActiveHoldsSection's PageSection title
//  - data-subject-requests→ DsarPolicyEditor's PageSection title
//  - feedback             → FeedbackMetricsPage's <h3>
//  - logs                 → AuditLogsPage's SettingsSection title
//  - audit-logs           → legacy alias, redirects to `logs`
//  - <index>              → redirects to `content-models`
const GOVERNANCE_PAGES: readonly GovernancePageCase[] = [
  { slug: 'content-models', headingKey: 'governance.systemPrompt.title' },
  { slug: 'usage', headingKey: 'analytics.usage.title' },
  { slug: 'guardrails', headingKey: 'governance.guardrailsOverview.title' },
  { slug: 'run-code-policy', headingKey: 'governance.runCodePolicy.title' },
  {
    slug: 'security-monitoring',
    headingKey: 'governance.loginPolicy.title',
  },
  { slug: 'trash', headingKey: 'governance.trash.title' },
  {
    slug: 'legal-hold',
    headingKey: 'governance.legalHold.sections.activeHolds.title',
  },
  {
    slug: 'data-subject-requests',
    headingKey: 'governance.dsarPolicy.title',
  },
  { slug: 'feedback', headingKey: 'analytics.feedback.title' },
  { slug: 'logs', headingKey: 'settings.logs.heading' },
  {
    slug: 'audit-logs',
    headingKey: 'settings.logs.heading',
    note: 'legacy alias → redirects to /logs',
  },
  {
    slug: '',
    headingKey: 'governance.systemPrompt.title',
    note: 'index → redirects to /content-models',
  },
];

test.describe('governance pages', () => {
  for (const { slug, headingKey, note } of GOVERNANCE_PAGES) {
    const label = slug === '' ? '<index>' : slug;
    test(`${label} loads and renders its primary section${
      note ? ` (${note})` : ''
    }`, async ({ page }) => {
      const { organizationId } = readRunContext();
      const base = GOVERNANCE_BASE(organizationId);
      await page.goto(slug === '' ? base : `${base}/${slug}`);

      // Data-backed pages paint behind a skeleton; a generous first-visibility
      // budget lets the cold Vite compile + Convex load settle before failing.
      await expect(
        page.getByRole('heading', { name: t(headingKey) }).first(),
      ).toBeVisible({ timeout: 60_000 });
    });
  }
});

/**
 * Guardrails Content-safety enable switch. Radix `Switch` exposes its checked
 * state via `aria-checked`; the toggle autosaves and surfaces the
 * `contentSafety.saved` toast (no separate Save button). Mirrors the
 * voice-output flow in `governance-settings.spec.ts`, on a different page/policy.
 */
function contentSafetySwitch(page: Page) {
  return page.getByRole('switch', {
    name: t('governance.contentSafety.enableLabel'),
  });
}

async function toggleContentSafetyAndAssertSaved(page: Page): Promise<void> {
  await contentSafetySwitch(page).click();
  await expect(
    page.getByText(t('governance.contentSafety.saved')).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test('toggles and persists the guardrails content-safety switch', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  const url = `${GOVERNANCE_BASE(organizationId)}/guardrails`;

  await page.goto(url);
  // The overview heading proves the page settled before we touch the switch.
  await expect(
    page
      .getByRole('heading', { name: t('governance.guardrailsOverview.title') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  const toggle = contentSafetySwitch(page);
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toBeEnabled();
  const initiallyChecked =
    (await toggle.getAttribute('aria-checked')) === 'true';

  await toggleContentSafetyAndAssertSaved(page);
  await expect(toggle).toHaveAttribute(
    'aria-checked',
    String(!initiallyChecked),
  );

  // Reload: the flipped value must come back from the backend, not local state.
  await page.reload();
  await expect(contentSafetySwitch(page)).toBeVisible({ timeout: 60_000 });
  await expect(contentSafetySwitch(page)).toHaveAttribute(
    'aria-checked',
    String(!initiallyChecked),
    { timeout: 20_000 },
  );

  // Restore the original value so re-runs (and the rest of the suite) start
  // from the same state.
  await toggleContentSafetyAndAssertSaved(page);
  await expect(contentSafetySwitch(page)).toHaveAttribute(
    'aria-checked',
    String(initiallyChecked),
  );
});

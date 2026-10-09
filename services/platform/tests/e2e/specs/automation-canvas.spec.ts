import type { Locator, Page } from '@playwright/test';

import {
  deleteAutomationRow,
  uploadAutomationDraft,
} from '../helpers/automations';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { labelStart } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * The automation canvas end to end, over transforms only (no provider, no
 * connector): upload a document whose condition has an alternative, read
 * the condition and its Yes and No on the canvas, change a field in the
 * inspector, save a version, test-run it, and find the branch the run took
 * on the run page's canvas. The probe is deleted at the end, so the worker
 * org leaves the spec as it entered.
 */

const PROBE_SLUG = 'canvas-branch-probe';

// The manual plan's branch probe (`AUTO-F73`): Score's total decides between
// Escalate (Yes) and its alternative File (No).
const PROBE_WORKFLOW_YML = `name: ${PROBE_SLUG}
description: E2E probe — a condition with an alternative, no connectors.
nodes:
  - id: score
    type: transform
    input: { total: 1200 }
    code: 'return { total: input.total };'
  - id: escalate
    type: transform
    when: '{{ nodes.score.output.total > 1000 }}'
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "escalate " + input.total };'
  - id: file
    type: transform
    elseOf: escalate
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "file " + input.total };'
output:
  text: '{{ nodes.escalate.output?.text ?? nodes.file.output?.text }}'
`;

/** The input that turns the condition false, typed into Score's Input. */
const SCORE_INPUT_BELOW = '{ "total": 50 }';

/** The condition's id on the canvas: one per node with a `when`. */
const GATE_ID = '__gate:escalate';

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** The automation's canvas once its layout has landed (busy until then). */
function laidOutCanvas(page: Page): Locator {
  return page
    .getByRole('group', {
      name: t('automations.canvas.ariaLabel'),
      exact: true,
    })
    .and(page.locator('[aria-busy="false"]'));
}

/** A box on the canvas — a node, Start, End or a condition — by its id. */
function flowNode(page: Page, id: string): Locator {
  return page.locator(`[data-flow-node="${id}"]`);
}

/** The Yes or No label on the line from the condition to `target`. */
function branchLabel(page: Page, target: string): Locator {
  return page.locator(`[data-flow-edge-label="${GATE_ID}>${target}"]`);
}

test('draws a condition with Yes and No, saves a field edit and shows the branch a run took', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const automationRoute = `/dashboard/${organizationId}/automations/${PROBE_SLUG}`;

  await uploadAutomationDraft(page, organizationId, PROBE_WORKFLOW_YML);
  await page.goto(`${automationRoute}/editor`);
  await expect(laidOutCanvas(page)).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // The condition stands above Escalate as a box of its own, named for the
  // node it decides on; Yes leads to Escalate and No to its alternative.
  const gateName = t('flow.gate.name')
    .replace('{node}', 'Escalate')
    .split('{condition}')[0];
  await expect(flowNode(page, GATE_ID)).toHaveAccessibleName(
    new RegExp(`^${escapeRegExp(gateName ?? '')}`),
  );
  await expect(branchLabel(page, 'escalate')).toHaveText(t('flow.branch.yes'));
  await expect(branchLabel(page, 'file')).toHaveText(t('flow.branch.no'));

  // Change Score's input in the inspector so the condition no longer holds.
  // The field is a code editor: replace its whole text in one insert, the way
  // a paste would, so no bracket is closed for us halfway.
  await flowNode(page, 'score').click();
  const input = page.getByRole('textbox', {
    name: labelStart(t('automations.editor.fields.input')),
  });
  await expect(input).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(SCORE_INPUT_BELOW);
  await expect(input).toHaveText(SCORE_INPUT_BELOW);

  // Save appends v2 and the editor shows it.
  await page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const saveDialog = page.getByRole('dialog', {
    name: t('automations.detail.saveDialog.title'),
  });
  await expect(saveDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await saveDialog
    .getByRole('textbox', {
      name: labelStart(t('automations.detail.saveMessageLabel')),
    })
    .fill('Score below the escalation threshold');
  await saveDialog
    .getByRole('button', {
      name: t('automations.detail.saveVersion'),
      exact: true,
    })
    .click();
  await expect(saveDialog).not.toBeVisible({ timeout: TIMEOUT.PERSIST });
  await expect(
    page.getByRole('button', {
      name: t('automations.detail.versionSelect'),
      exact: true,
    }),
  ).toContainText(
    t('automations.versions.versionLabel').replace('{version}', '2'),
    {
      timeout: TIMEOUT.PERSIST,
    },
  );

  // The document declares no input, so Test run starts at once.
  await page
    .getByRole('button', { name: t('automations.detail.runMock'), exact: true })
    .filter({ visible: true })
    .first()
    .click();

  // The runs list does not refresh itself: reload until the run has settled.
  const runsRoute = `${automationRoute}/runs`;
  const succeeded = page.getByText(t('automations.runs.status.success'), {
    exact: true,
  });
  await expect(async () => {
    await page.goto(runsRoute);
    await expect(succeeded.first()).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }).toPass({ timeout: TIMEOUT.EXECUTION });
  await page.locator('a[href*="/runs/"]').first().click();
  await page.waitForURL(/\/runs\/[^/?#]+(?:[?#]|$)/, { timeout: TIMEOUT.NAV });

  // The run page's canvas says how the condition decided: No, so the line
  // to File is taken and the one to Escalate is not; File ran, Escalate was
  // skipped.
  await expect(laidOutCanvas(page)).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  await expect(
    flowNode(page, GATE_ID).locator('[data-slot="flow-gate-decision"]'),
  ).toHaveText(t('flow.branch.no'), { timeout: TIMEOUT.VISIBLE });
  await expect(branchLabel(page, 'file')).toHaveAttribute('data-taken', 'true');
  await expect(branchLabel(page, 'escalate')).toHaveAttribute(
    'data-taken',
    'false',
  );
  await expect(flowNode(page, 'file')).toHaveAttribute(
    'data-flow-state',
    'succeeded',
  );
  await expect(flowNode(page, 'escalate')).toHaveAttribute(
    'data-flow-state',
    'skipped',
  );

  // Cleanup: the probe goes, with its versions; its finished run stays in
  // the run history.
  await page.goto(`/dashboard/${organizationId}/automations`);
  await deleteAutomationRow(
    page,
    page.getByRole('row').filter({ hasText: PROBE_SLUG }).first(),
  );
});

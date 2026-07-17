/**
 * Choreography for the sync-probe diagnostic (see episode.ts for what each
 * beat proves and how to verify the composed output).
 */

import type { SceneChoreography } from '../../lib/scene';

export const SCENES: readonly SceneChoreography[] = [
  {
    id: 'title',
    run: async ({ page }) => {
      await page.evaluate(() => window.__taleVideoCard?.reveal());
    },
  },
  {
    id: 'probe',
    run: async ({ page, cursor, cue }) => {
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(400));
      await page.evaluate(() => {
        const target = document.createElement('button');
        target.id = 'probe-target';
        target.textContent = 'Probe target';
        target.style.cssText =
          'position:fixed;left:22%;top:52%;padding:14px 24px;font-size:18px;' +
          'border-radius:8px;border:1px solid #94a3b8;background:#f8fafc;';
        document.body.appendChild(target);
      });
      // The visual sync marker: solid red exactly 1.0 s into the narration
      // window — compare the flip frame's timestamp against the plan.
      await cue(1.0);
      await page.evaluate(() => {
        document.body.style.background = '#dc2626';
      });
      await cue(2.0);
      await cursor.show();
      await cursor.click(page.locator('#probe-target'));
    },
  },
];

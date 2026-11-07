// Shared Storybook manager (sidebar / toolbar) config. Every Tale service's
// `.storybook/manager.ts` just imports + calls this so they all render the
// same chrome.

import { addons } from 'storybook/manager-api';

export function applyStorybookManagerConfig(): void {
  addons.setConfig({
    showToolbar: true,
    sidebar: { showRoots: true },
  });
}

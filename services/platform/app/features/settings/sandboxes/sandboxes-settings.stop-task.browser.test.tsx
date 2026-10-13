import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';

import '@/app/globals.css';
// Run the same real-action/viewport regressions in Chromium, including the
// keyboard path through the row menu, without copying a second test model.
import './sandboxes-settings.stop-task.test';

beforeEach(async () => {
  await page.viewport(375, 812);
});

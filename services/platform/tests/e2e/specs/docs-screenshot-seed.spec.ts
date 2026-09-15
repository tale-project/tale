import { expect, test } from '@playwright/test';

import {
  settleList,
  settleListOrEmpty,
  webdavPasswordRow,
} from '../../docs-screenshots/seed-demo-org';

// Synthetic DOM fixtures exercise the seeder's readiness signal without
// signing in or changing organization data. Chromium belongs to this E2E lane.
test.use({ storageState: { cookies: [], origins: [] } });
const LIST_RESPONSE_DELAY_MS = 500;

for (const kind of ['list', 'list-or-empty']) {
  test(`screenshot seeding waits for existing rows in ${kind}`, async ({
    page,
  }) => {
    await page.setContent(`
          <div role="status" aria-busy="true">Loading content</div>
          <div role="status">Ready to work offline</div>
          <table><tbody></tbody></table>
          <script>
            setTimeout(() => {
              document.querySelector('tbody').innerHTML =
                '<tr><td>Existing knowledge entry</td></tr>';
              const footer = document.createElement('output');
              footer.textContent = 'Showing all 1 knowledge entry';
              document.body.append(footer);
              document.querySelector('[aria-busy]').remove();
            }, ${LIST_RESPONSE_DELAY_MS});
          </script>
        `);
    if (kind === 'list') await settleList(page);
    else await settleListOrEmpty(page, page.getByText('No entries yet'));
    // A premature return makes the seeder create this existing entry again.
    expect(await page.getByText('Existing knowledge entry').isVisible()).toBe(
      true,
    );
  });
}

test('a retired device does not satisfy the missing active WebDAV fixture', async ({
  page,
}) => {
  await page.setContent(`
    <table><tbody>
      <tr><td><span>Retired design workstation</span><span>revoked</span></td></tr>
    </tbody></table>
  `);
  expect(await webdavPasswordRow(page, 'Design workstation').count()).toBe(0);
  expect(
    await webdavPasswordRow(page, 'Retired design workstation').count(),
  ).toBe(1);
  await page.locator('tbody').evaluate((body) => {
    const row = document.createElement('tr');
    row.innerHTML = '<td><span>Design workstation</span></td>';
    body.append(row);
  });
  expect(await webdavPasswordRow(page, 'Design workstation').count()).toBe(1);
});

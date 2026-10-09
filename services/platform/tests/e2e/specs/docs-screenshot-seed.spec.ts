import { expect, test } from '@playwright/test';

import { CAPTURE_LOCALES } from '../../docs-screenshots/capture-options';
import {
  DEMO_LAUNCH_TASK_DETAIL,
  DEMO_PROJECTS,
} from '../../docs-screenshots/demo-content';
import { withCaptureLocale } from '../../docs-screenshots/i18n';
import { SHOTS } from '../../docs-screenshots/manifest';
import {
  projectFileRow,
  settleList,
  settleListOrEmpty,
  settleProjectFiles,
  webdavPasswordRow,
} from '../../docs-screenshots/seed-demo-org';
import { t } from '../helpers/i18n';

// Synthetic DOM fixtures exercise the seeder's readiness signal without
// signing in or changing organization data. Chromium belongs to this E2E lane.
test.use({ storageState: { cookies: [], origins: [] } });
const LIST_RESPONSE_DELAY_MS = 500;

for (const locale of CAPTURE_LOCALES) {
  test(`task detail capture waits for the activity response in ${locale}`, async ({
    page,
  }) => {
    await withCaptureLocale(locale, async () => {
      const shot = SHOTS.find(({ name }) => name === 'project-task-detail');
      if (!shot) throw new Error('Task detail capture is not registered');
      const comment = DEMO_LAUNCH_TASK_DETAIL.comment;
      const context = {
        orgId: 'synthetic-capture',
        threads: new Map<string, string>(),
        projects: new Map<string, string>(),
      };
      let releaseResponse: () => void = () => {};
      let markRequested: () => void = () => {};
      const responseAllowed = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        markRequested = resolve;
      });
      await page.route('https://capture.example/activity', async (route) => {
        markRequested();
        await responseAllowed;
        await route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ comment }),
        });
      });
      await page.setContent(`
        <p>${comment}</p>
        <div role="dialog" aria-label="Unrelated task"><p>${comment}</p></div>
        <div role="dialog" aria-labelledby="task-title">
          <h2 id="task-title">${DEMO_PROJECTS[0].tasks[0].title}</h2>
          <p>The native task brief and saved comment have loaded.</p>
          <section id="history"></section>
        </div>
        <script>
          fetch('https://capture.example/activity')
            .then(response => response.json())
            .then(({ comment }) => {
              const savedComment = document.createElement('p');
              savedComment.textContent = comment;
              document.querySelector('#history').append(savedComment);
            });
        </script>
      `);
      await requested;
      await expect(
        page.getByRole('dialog', {
          name: DEMO_PROJECTS[0].tasks[0].title,
          exact: true,
        }),
      ).toBeVisible();
      // A dialog-only gate, or a namesake comment outside the exact task, admits an
      // incomplete screenshot while the independent native query is held.
      expect(await shot.readyWhen(page, context).count()).toBe(0);
      releaseResponse();
      await expect(shot.readyWhen(page, context)).toBeVisible();
    });
  });
}

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

// The project Files tab as an editor meets it: the upload dropzone is up at
// once, while the list skeleton stands beside it until the documents read
// answers. Labels come from the catalogs, as the seeder's own locators do.
const FILES_LIST_LABEL = t('projects.files.treeLabel');
const DROPZONE_LABEL = t('projects.files.addButton');
const SKELETON_LABEL = t('skeleton.loading');
const INDEXED_LABEL = t('projects.files.ragStatusCompleted');

function loadingFilesTab(settled: string): string {
  return `
    <div role="status" aria-busy="true" aria-label="${SKELETON_LABEL}"></div>
    <div role="button" tabindex="0" aria-label="${DROPZONE_LABEL}">
      ${DROPZONE_LABEL}
    </div>
    <script>
      setTimeout(() => {
        document.querySelector('[aria-busy]').remove();
        document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(settled)});
      }, ${LIST_RESPONSE_DELAY_MS});
    </script>
  `;
}

test('screenshot seeding waits for the files a project already holds', async ({
  page,
}) => {
  await page.setContent(
    loadingFilesTab(`
      <ul aria-label="${FILES_LIST_LABEL}">
        <li><button aria-label="inventory.txt">inventory.txt</button>
          <span>${INDEXED_LABEL}</span></li>
      </ul>
    `),
  );
  await settleProjectFiles(page);
  // A premature return makes the seeder upload this attached file again.
  expect(await projectFileRow(page, 'inventory.txt').isVisible()).toBe(true);
});

test('screenshot seeding reads a fileless project once its skeleton is gone', async ({
  page,
}) => {
  await page.setContent(loadingFilesTab(''));
  await settleProjectFiles(page);
  expect(await page.getByRole('status').count()).toBe(0);
  expect(await projectFileRow(page, 'inventory.txt').count()).toBe(0);
});

test('a project file row is the file item itself, never a namesake or its folder', async ({
  page,
}) => {
  await page.setContent(`
    <ul aria-label="${FILES_LIST_LABEL}">
      <li><button aria-label="Launch" aria-expanded="true">Launch</button>
        <ul>
          <li><button aria-label="runbook.txt">runbook.txt</button>
            <span>${INDEXED_LABEL}</span></li>
        </ul>
      </li>
      <li><button aria-label="runbook.txt.bak">runbook.txt.bak</button></li>
    </ul>
  `);
  const row = projectFileRow(page, 'runbook.txt');
  expect(await row.getByText(INDEXED_LABEL).count()).toBe(1);
  expect(await row.getByRole('button').count()).toBe(1);
  expect(await projectFileRow(page, 'runbook.txt.bak').count()).toBe(1);
});

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

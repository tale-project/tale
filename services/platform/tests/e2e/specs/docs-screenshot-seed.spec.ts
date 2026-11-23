import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

import { CAPTURE_LOCALES } from '../../docs-screenshots/capture-options';
import {
  DEMO_LAUNCH_TASK_DETAIL,
  DEMO_PROJECTS,
} from '../../docs-screenshots/demo-content';
import { withCaptureLocale } from '../../docs-screenshots/i18n';
import { SHOTS, type ShotContext } from '../../docs-screenshots/manifest';
import {
  chooseEmbeddingProvider,
  projectFileRow,
  saveProjectOverview,
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
      const context: ShotContext = {
        orgId: 'synthetic-capture',
        device: 'desktop',
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

// The embedding form's Provider select as the seeder meets it once the
// providers listing has answered: each option reads its provider's display
// name, which the listing takes from the provider's definition — for the
// mock, the docs-demo template the seeder copies into the organization.
const MOCK_PROVIDER_DEFINITION = parseYaml(
  readFileSync(
    new URL(
      '../fixtures/config/docs-demo/providers/e2e-mock.yml',
      import.meta.url,
    ),
    'utf8',
  ),
) as { name: string; displayName: string };
const EMBEDDING_PROVIDER_LABEL = t(
  'settings.dataResidency.orgEmbedding.provider',
);

test('the embedding step chooses the mock provider by the name its option reads', async ({
  page,
}) => {
  const { name, displayName } = MOCK_PROVIDER_DEFINITION;
  await page.setContent(`
    <button role="combobox" aria-label="${EMBEDDING_PROVIDER_LABEL}"
      aria-expanded="false" aria-controls="providers" data-value="">Choose</button>
    <div id="providers" role="listbox" hidden>
      <div role="option" aria-selected="false" data-value="openrouter">OpenRouter</div>
      <div role="option" aria-selected="false" data-value="${name}">${displayName}</div>
    </div>
    <script>
      const select = document.querySelector('[role="combobox"]');
      const list = document.getElementById('providers');
      select.addEventListener('click', () => {
        list.hidden = false;
        select.setAttribute('aria-expanded', 'true');
      });
      for (const option of list.querySelectorAll('[role="option"]')) {
        option.addEventListener('click', () => {
          select.dataset.value = option.dataset.value;
          list.hidden = true;
          select.setAttribute('aria-expanded', 'false');
        });
      }
    </script>
  `);
  // Asked for by its slug, the option never came and the step timed out.
  await chooseEmbeddingProvider(page);
  await expect(
    page.getByRole('combobox', { name: EMBEDDING_PROVIDER_LABEL }),
  ).toHaveAttribute('data-value', name);
});

// The project General tab's Save as the seeder meets it: the button turns
// disabled the moment it is pressed, while the writes of the sections it
// saves, one after the other, are still on their way.
const SAVE_LABEL = t('common.actions.save');

test('the project save waits for its writes before the seeder reloads', async ({
  page,
}) => {
  const held: Array<() => void> = [];
  await page.route(
    'https://capture.example/api/app/projects/demo-project/*',
    async (route) => {
      await new Promise<void>((release) => held.push(release));
      await route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      });
    },
  );
  await page.setContent(`
    <button>${SAVE_LABEL}</button>
    <script>
      const save = document.querySelector('button');
      save.addEventListener('click', async () => {
        save.disabled = true;
        for (const section of ['instructions', 'identity']) {
          await fetch(
            'https://capture.example/api/app/projects/demo-project/' + section,
            { method: 'POST', body: '{}' },
          );
        }
      });
    </script>
  `);
  let saved = false;
  const saving = saveProjectOverview(page, 'demo-project', [
    'identity',
    'instructions',
  ]).then(() => {
    saved = true;
  });
  // Disabled at once, with both writes still to answer: the seeder read this
  // as saved and reloaded, which cut them off.
  await expect(page.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
  await expect.poll(() => held.length).toBe(1);
  expect(saved).toBe(false);
  held[0]();
  await expect.poll(() => held.length).toBe(2);
  expect(saved).toBe(false);
  held[1]();
  await saving;
  expect(saved).toBe(true);
});

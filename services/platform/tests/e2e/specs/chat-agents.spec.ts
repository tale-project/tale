import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';
import { z } from 'zod';

import {
  MOCK_PERSONA,
  MOCK_PROPOSALS,
  MOCK_TRIGGERS,
} from '../../../lib/mocks/overrides/canned';
import {
  deleteThreadById,
  messageLog,
  sendInOpenThread,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../helpers/chat';
import { BASE_URL, isMockLlmMode, TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { connectMockProvider } from '../helpers/providers';

/**
 * Who answers in a project chat, and the changes a chat proposes: a chat in
 * a project answers as the project's first agent, with its instructions,
 * and its owner switches to the assistant; a chat proposes an agent, and
 * only Apply makes it; a dismissed proposal makes nothing. Every reply comes
 * from the mock LLM's scripted triggers, so the spec runs in mock mode only.
 */

const headers = { origin: BASE_URL };

async function createProject(
  page: Page,
  organizationId: string,
  name: string,
): Promise<string> {
  const response = await page.request.post(
    `/api/app/projects?orgId=${organizationId}`,
    { headers, data: { name } },
  );
  expect(response.status(), await response.text()).toBe(200);
  return z.object({ projectId: z.string() }).parse(await response.json())
    .projectId;
}

async function createAgent(
  page: Page,
  organizationId: string,
  projectId: string,
  name: string,
): Promise<void> {
  const response = await page.request.post(
    `/api/app/projects/${projectId}/agents?orgId=${organizationId}`,
    {
      headers,
      data: {
        name,
        harness: 'claude-code',
        model: 'e2e-chat-model',
        modelProvider: 'e2e-mock',
        skills: [],
        connectors: [],
        // The mock answers `e2e:who-answers` with the name on this line.
        instructions: `${MOCK_PERSONA.marker} ${name}\nReview the copy.`,
      },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function agentNames(
  page: Page,
  organizationId: string,
  projectId: string,
): Promise<string[]> {
  const response = await page.request.get(
    `/api/app/projects/${projectId}/agents?orgId=${organizationId}`,
    { headers },
  );
  return z
    .object({ agents: z.array(z.looseObject({ name: z.string() })) })
    .parse(await response.json())
    .agents.map((agent) => agent.name);
}

async function deleteProject(
  page: Page,
  organizationId: string,
  projectId: string,
  name: string,
): Promise<void> {
  const response = await page.request.delete(
    `/api/app/projects/${projectId}?orgId=${organizationId}`,
    { headers, data: { mode: 'cascade', confirmPhrase: name } },
  );
  expect(response.status(), await response.text()).toBe(200);
}

test.describe('chat agents and proposals', () => {
  test.skip(!isMockLlmMode(), 'the replies are the mock LLM’s scripts');

  test.beforeEach(async ({ page, org }) => {
    await connectMockProvider(page.request, org.organizationId);
  });

  test('a project chat answers as its first agent, and its owner switches to the assistant [CHAT-R41] [CHAT-R42] [CHAT-R43]', async ({
    page,
    org,
  }) => {
    const suffix = randomUUID().slice(0, 6);
    const projectName = `Agents ${suffix}`;
    const reviewer = `Copy reviewer ${suffix}`;
    const projectId = await createProject(
      page,
      org.organizationId,
      projectName,
    );
    await createAgent(page, org.organizationId, projectId, reviewer);
    await createAgent(page, org.organizationId, projectId, `Coder ${suffix}`);

    await page.goto(
      `/dashboard/${org.organizationId}/chat?projectId=${projectId}`,
    );
    const picker = page.getByRole('button', {
      name: t('chat.agentPicker.aria').replace('{name}', reviewer),
    });
    await expect(picker).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const threadId = await sendNewThreadMessage(
      page,
      `${MOCK_TRIGGERS.whoAnswers} who answers here?`,
    );
    await waitForReplyComplete(page);
    const log = messageLog(page);
    await expect(log.getByText(MOCK_PERSONA.reply(reviewer))).toBeVisible({
      timeout: TIMEOUT.REPLY,
    });
    await expect(
      log.getByText(t('chat.replyAuthor.agentBadge')).first(),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: t('chat.agentPicker.aria').replace('{name}', reviewer),
      })
      .click();
    await page
      .getByRole('menuitemradio', { name: t('chat.agentPicker.assistant') })
      .click();
    await expect(
      page.getByRole('button', {
        name: t('chat.agentPicker.aria').replace(
          '{name}',
          t('chat.agentPicker.assistant'),
        ),
      }),
    ).toBeVisible({ timeout: TIMEOUT.PERSIST });
    await sendInOpenThread(page, `${MOCK_TRIGGERS.whoAnswers} and now?`);
    await expect(log.getByText(MOCK_PERSONA.none)).toBeVisible({
      timeout: TIMEOUT.REPLY,
    });

    await deleteThreadById(page, threadId);
    await deleteProject(page, org.organizationId, projectId, projectName);
  });

  test('a chat proposes an agent, and only Apply makes it [CHAT-R44]', async ({
    page,
    org,
  }) => {
    const suffix = randomUUID().slice(0, 6);
    const projectName = `Proposals ${suffix}`;
    const projectId = await createProject(
      page,
      org.organizationId,
      projectName,
    );
    const agent = MOCK_PROPOSALS.agent(projectName);

    await page.goto(`/dashboard/${org.organizationId}/chat?new=true`);
    const threadId = await sendNewThreadMessage(
      page,
      `${MOCK_TRIGGERS.proposeAgent} ${projectName}`,
    );
    await waitForReplyComplete(page);
    const card = page.getByRole('region', {
      name: t('chat.proposal.title.createAgent').replace(
        '{project}',
        projectName,
      ),
    });
    await expect(card).toBeVisible({ timeout: TIMEOUT.REPLY });
    await expect(card).toContainText(agent.name);
    await expect(card).toContainText(t('chat.proposal.nothingYet'));
    expect(await agentNames(page, org.organizationId, projectId)).toEqual([]);

    await card.getByRole('button', { name: t('chat.proposal.apply') }).click();
    await expect(card).toContainText(t('chat.proposal.status.applied'), {
      timeout: TIMEOUT.PERSIST,
    });
    expect(await agentNames(page, org.organizationId, projectId)).toEqual([
      agent.name,
    ]);

    // The outcome is the proposal's, not this tab's: a reload keeps it.
    await page.reload();
    const reloaded = page.getByRole('region', {
      name: t('chat.proposal.title.createAgent').replace(
        '{project}',
        projectName,
      ),
    });
    await expect(reloaded).toContainText(t('chat.proposal.status.applied'), {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(
      reloaded.getByRole('button', { name: t('chat.proposal.apply') }),
    ).toHaveCount(0);
    await expect(
      reloaded.getByRole('link', { name: t('chat.proposal.openAgents') }),
    ).toBeVisible();

    await deleteThreadById(page, threadId);
    await deleteProject(page, org.organizationId, projectId, projectName);
  });

  test('a dismissed proposal makes nothing [CHAT-R44]', async ({
    page,
    org,
  }) => {
    await page.goto(`/dashboard/${org.organizationId}/chat?new=true`);
    const threadId = await sendNewThreadMessage(
      page,
      MOCK_TRIGGERS.proposeProject,
    );
    await waitForReplyComplete(page);
    const card = page.getByRole('region', {
      name: t('chat.proposal.title.createProject'),
    });
    await expect(card).toBeVisible({ timeout: TIMEOUT.REPLY });
    await expect(card).toContainText(MOCK_PROPOSALS.project.name);

    await card
      .getByRole('button', { name: t('chat.proposal.dismiss') })
      .click();
    await expect(card).toContainText(t('chat.proposal.status.dismissed'), {
      timeout: TIMEOUT.PERSIST,
    });
    const projects = z
      .object({ projects: z.array(z.looseObject({ name: z.string() })) })
      .parse(
        await (
          await page.request.get(
            `/api/app/projects?orgId=${org.organizationId}`,
            { headers },
          )
        ).json(),
      );
    expect(
      projects.projects.some(
        (project) => project.name === MOCK_PROPOSALS.project.name,
      ),
    ).toBe(false);

    await deleteThreadById(page, threadId);
  });
});

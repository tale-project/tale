// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildPersonalNotificationUrl } from './personal_notification_url';

/**
 * The email half of the notification deep link. Its in-app twin
 * (`app/features/notifications/lib/notification-target.ts`) is hand-mirrored,
 * so every branch here has a counterpart there; the parity suite next to that
 * file drives both from one table.
 */

const ENV_KEYS = ['SITE_URL', 'ADDITIONAL_SITE_URLS', 'BASE_PATH'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const ORG = 'org_1';
const SITE = 'https://app.example.com';

describe('buildPersonalNotificationUrl — routing', () => {
  it('opens a task inside its project', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        taskId: 'task_1',
        params: { projectId: 'proj_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/projects/proj_1/tasks?task=task_1`);
  });

  it('opens a chat thread', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { chat: true, threadId: 'thread_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/chat/thread_1`);
  });

  it('opens a conversation, defaulting the status segment to open', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { conversationId: 'conv_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/conversations/open?conversation=conv_1`);
  });

  it('carries a non-open conversation status into the segment', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { conversationId: 'conv_1', conversationStatus: 'closed' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/conversations/closed?conversation=conv_1`);
  });

  it('opens a project document in its Files tab, with the folder', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1', projectId: 'proj_1', folderId: 'f_1' },
        siteUrl: SITE,
      }),
    ).toBe(
      `${SITE}/dashboard/${ORG}/projects/proj_1/files?doc=doc_1&folderId=f_1`,
    );
  });

  it('opens a library document in the org-wide list', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/documents?doc=doc_1`);
  });

  it('lands a legacy discussion mention on the project board', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { threadId: 'thread_1', projectId: 'proj_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/projects/proj_1/tasks`);
  });

  it('opens the run for an escalation with no task and no project', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { name: 'billing/dunning-reminder', runId: 'run_1' },
        siteUrl: SITE,
      }),
    ).toBe(
      `${SITE}/dashboard/${ORG}/automations/billing__dunning-reminder/runs/run_1`,
    );
  });

  // Never null: an email that names something the reader cannot reach is
  // the defect. A row with no entity context still gets a way in.
  it('lands on the org dashboard when there is no entity context', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        taskId: 'task_1',
        params: { title: 'No project here' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}`);
  });
});

describe('buildPersonalNotificationUrl — origin', () => {
  it('prefers an explicit siteUrl over the environment', () => {
    process.env.SITE_URL = 'https://ignored.example.com';
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1' },
        siteUrl: SITE,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/documents?doc=doc_1`);
  });

  it('reads SITE_URL at call time, not at module load', () => {
    // The regression: SITE_URL used to be captured in a module-level
    // constant, so a worker importing this before its env was in place
    // shipped localhost links for the life of the process.
    process.env.SITE_URL = 'https://first.example.com';
    const first = buildPersonalNotificationUrl({
      organizationId: ORG,
      params: { documentId: 'doc_1' },
    });
    process.env.SITE_URL = 'https://second.example.com';
    const second = buildPersonalNotificationUrl({
      organizationId: ORG,
      params: { documentId: 'doc_1' },
    });

    expect(first).toBe(
      `https://first.example.com/dashboard/${ORG}/documents?doc=doc_1`,
    );
    expect(second).toBe(
      `https://second.example.com/dashboard/${ORG}/documents?doc=doc_1`,
    );
  });

  it('carries BASE_PATH, so a subpath deployment does not 404', () => {
    process.env.SITE_URL = SITE;
    process.env.BASE_PATH = '/tale';
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1' },
      }),
    ).toBe(`${SITE}/tale/dashboard/${ORG}/documents?doc=doc_1`);
  });

  it('trims a trailing slash off the origin', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1' },
        siteUrl: `${SITE}/`,
      }),
    ).toBe(`${SITE}/dashboard/${ORG}/documents?doc=doc_1`);
  });

  it('falls back to the local origin when SITE_URL is unset', () => {
    expect(
      buildPersonalNotificationUrl({
        organizationId: ORG,
        params: { documentId: 'doc_1' },
      }),
    ).toBe(`http://127.0.0.1:3000/dashboard/${ORG}/documents?doc=doc_1`);
  });
});

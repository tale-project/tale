// Overview and settings. The one setting an assistant cannot change is the
// switch for AI access itself: that is the user's alone.

import { z } from 'zod';

import { startPageSchema } from '../../../lib/api/schemas.ts';
import { READ_ONLY, defineTool, json } from './tool.ts';

const overview = defineTool({
  name: 'overview',
  group: 'overview',
  title: 'Overview',
  description:
    'Where to start: the sessions and their status, how many proxies there are and how many are free, the number of secrets, the start page, and whether the browser (Camoufox) is installed.',
  input: z.strictObject({}),
  annotations: READ_ONLY,
  routes: ['GET /meta'],
  async run(_args, { manager }) {
    const meta = manager.meta();
    const { counts } = meta;
    return json({
      sessions: manager
        .listSessions()
        .map((session) => ({ name: session.name, status: session.status })),
      next_session_name: meta.nextSessionName,
      proxies: {
        total: counts.proxies,
        free: counts.freeProxies,
        failed: counts.failedProxies,
        being_checked: counts.checkingProxies,
      },
      secrets: counts.secrets,
      start_page: manager.settings().startPage,
      browser: {
        installed: meta.browserInstalled,
        installing: meta.browserInstalling,
        progress: meta.browserInstallProgress,
        problem: meta.browserInstallError,
      },
      version: meta.version,
    });
  },
});

const getSettings = defineTool({
  name: 'get_settings',
  group: 'overview',
  title: 'Get settings',
  description:
    'The settings: the start page that new sessions (and sessions that were left without open tabs) open.',
  input: z.strictObject({}),
  annotations: READ_ONLY,
  routes: ['GET /settings'],
  async run(_args, { manager }) {
    const settings = manager.settings();
    return json({
      start_page: settings.startPage,
      default_start_page: settings.defaultStartPage,
    });
  },
});

const setStartPage = defineTool({
  name: 'set_start_page',
  group: 'overview',
  title: 'Set the start page',
  description: 'Change the start page (an empty address restores the default).',
  input: z.strictObject({
    url: startPageSchema.describe('The address of the start page.'),
  }),
  routes: ['PATCH /settings'],
  async run({ url }, { manager }) {
    const settings = manager.updateSettings({ startPage: url });
    return json({ start_page: settings.startPage });
  },
});

export const overviewTools = [overview, getSettings, setStartPage];

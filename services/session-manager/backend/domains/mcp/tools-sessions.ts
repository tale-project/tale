// Sessions: the browsers, their proxies and their lifecycle.

import { z } from 'zod';

import {
  SESSION_STATUSES,
  osChoiceSchema,
  sessionNameSchema,
} from '../../../lib/api/schemas.ts';
import { sessionRef } from './args.ts';
import { sessionDetails, sessionText } from './format.ts';
import { sessionIdOf } from './lookup.ts';
import { DESTRUCTIVE, READ_ONLY, defineTool, json } from './tool.ts';
import { STOP_TIMEOUT, until, untilStarted } from './waiting.ts';

const onlySession = z.strictObject({ session: sessionRef });

const listSessions = defineTool({
  name: 'list_sessions',
  group: 'sessions',
  title: 'List sessions',
  description:
    'All sessions (newest first) with their status (stopped, starting, running, stopping or error), proxy, IP address, country, timezone and location. `status` lists only the ones in that state.',
  input: z.strictObject({
    status: z
      .enum(SESSION_STATUSES)
      .nullish()
      .describe('Only the sessions that are in this state.'),
  }),
  annotations: READ_ONLY,
  routes: ['GET /sessions'],
  async run({ status }, { manager }) {
    return json(
      manager
        .listSessions()
        .filter((session) => status == null || session.status === status)
        .map(sessionText),
    );
  },
});

const getSession = defineTool({
  name: 'get_session',
  group: 'sessions',
  title: 'Get a session',
  description:
    'One session in detail: also its fingerprint (user agent, platform, screen, GPU) and dates.',
  input: onlySession,
  annotations: READ_ONLY,
  routes: ['GET /sessions/:id'],
  async run({ session }, { manager }) {
    return json(sessionDetails(manager.session(sessionIdOf(manager, session))));
  },
});

const createSession = defineTool({
  name: 'create_session',
  group: 'sessions',
  title: 'Create a session',
  description:
    'Create a session and start it (it takes a proxy of its own, so a free proxy is needed). The name defaults to the next free number such as 0002. Returns once it is running or has failed.',
  input: z.strictObject({
    name: sessionNameSchema
      .nullish()
      .describe('The name; the next free number without one.'),
    os: osChoiceSchema
      .default('random')
      .describe('The operating system its fingerprint is of.'),
  }),
  routes: ['POST /sessions'],
  async run({ name, os }, context) {
    const created = await context.manager.createSession({
      name: name ?? null,
      os,
    });
    return json(await untilStarted(context, created.id));
  },
});

const startSession = defineTool({
  name: 'start_session',
  group: 'sessions',
  title: 'Start a session',
  description:
    'Start a stopped session; it reopens the tabs it had, or the start page. Returns once it is running. Another running session with the same exit IP address stops it, unless `force` is true.',
  input: z.strictObject({
    session: sessionRef,
    force: z
      .boolean()
      .default(false)
      .describe('Start even if another running session has the same exit IP.'),
  }),
  routes: ['POST /sessions/:id/start'],
  async run({ session, force }, context) {
    const { manager } = context;
    const started = await manager.startSession(sessionIdOf(manager, session), {
      force,
    });
    return json(await untilStarted(context, started.id));
  },
});

const stopSession = defineTool({
  name: 'stop_session',
  group: 'sessions',
  title: 'Stop a session',
  description:
    "Close a session's browser. Its tabs, cookies and logins are kept for the next start.",
  input: onlySession,
  routes: ['POST /sessions/:id/stop'],
  async run({ session }, context) {
    const { manager } = context;
    const stopped = await manager.stopSession(sessionIdOf(manager, session));
    const settled = await until(
      context,
      stopped.id,
      (current) => current.status !== 'stopping',
      STOP_TIMEOUT,
    );
    return json(sessionText(settled));
  },
});

const restartSession = defineTool({
  name: 'restart_session',
  group: 'sessions',
  title: 'Restart a session',
  description:
    "Close a running session's browser and open it again with the same proxy and tabs. Its timezone and geolocation are derived again from the proxy's exit IP as it is now: use it when `location.matches_ip` is false. Returns once it is running again.",
  input: onlySession,
  routes: ['POST /sessions/:id/restart'],
  async run({ session }, context) {
    const { manager } = context;
    const restarted = await manager.restartSession(
      sessionIdOf(manager, session),
    );
    return json(await untilStarted(context, restarted.id));
  },
});

const rotateSessionIp = defineTool({
  name: 'rotate_session_ip',
  group: 'sessions',
  title: 'Rotate the IP of a session',
  description:
    'Give a session another proxy (so another IP address, timezone and language), keeping its tabs and logins. A running session restarts; this returns once it is running again.',
  input: onlySession,
  routes: ['POST /sessions/:id/rotate'],
  async run({ session }, context) {
    const { manager } = context;
    const rotated = await manager.rotateSession(sessionIdOf(manager, session));
    return json(await untilStarted(context, rotated.id));
  },
});

const checkSessionIp = defineTool({
  name: 'check_session_ip',
  group: 'sessions',
  title: 'Check the IP of a session',
  description:
    "Look at the IP address the session's proxy exits through right now. `location.matches_ip` says whether it is still the IP that the session's timezone, language and geolocation were derived from (false: they no longer fit; restart_session fixes that).",
  input: onlySession,
  routes: ['POST /sessions/:id/check-ip'],
  async run({ session }, { manager }) {
    const checked = await manager.checkSessionIp(sessionIdOf(manager, session));
    return json(sessionText(checked));
  },
});

const renameSession = defineTool({
  name: 'rename_session',
  group: 'sessions',
  title: 'Rename a session',
  description: 'Rename a session.',
  input: z.strictObject({
    session: sessionRef,
    name: sessionNameSchema.describe('The new name.'),
  }),
  routes: ['PATCH /sessions/:id'],
  async run({ session, name }, { manager }) {
    return json(
      sessionText(manager.renameSession(sessionIdOf(manager, session), name)),
    );
  },
});

const deleteSession = defineTool({
  name: 'delete_session',
  group: 'sessions',
  title: 'Delete a session',
  description:
    'Delete a session for good: its browser profile (cookies, logins, history) and its own secrets. Its proxy becomes free.',
  input: onlySession,
  annotations: DESTRUCTIVE,
  routes: ['DELETE /sessions/:id'],
  async run({ session }, { manager }) {
    await manager.deleteSession(sessionIdOf(manager, session));
    return `Deleted session ${session}.`;
  },
});

const exportProxies = defineTool({
  name: 'export_proxies',
  group: 'sessions',
  title: 'Export the proxies of the sessions',
  description:
    "The proxies of the sessions as a proxy file (the format of the web page's “Export Proxy JSON”), each named after its session. It has the passwords of the proxies.",
  input: z.strictObject({}),
  // Not READ_ONLY: it returns the passwords of the proxies (see get_secret).
  routes: ['GET /sessions/export-proxies'],
  async run(_args, { manager }) {
    return json(manager.exportProxies());
  },
});

export const sessionTools = [
  listSessions,
  getSession,
  createSession,
  startSession,
  stopSession,
  restartSession,
  rotateSessionIp,
  checkSessionIp,
  renameSession,
  deleteSession,
  exportProxies,
];

/**
 * Reading journeys: what a person does with the app open — glance at Home,
 * clear the bell, look at a board, search, switch to their other
 * organization. Mostly reads; the writes are the small ones reading
 * implies (marking things read).
 */

import { searchThreads } from '../../api/chat.ts';
import { listHubDocuments, searchHub } from '../../api/knowledge.ts';
import { userPreferences, currentUser } from '../../api/shell.ts';
import {
  getTask,
  listProjectBoard,
  listTaskComments,
  taskActivity,
} from '../../api/tasks.ts';
import {
  listContacts,
  listMyNotifications,
  listOrgNotifications,
  markAllMyNotificationsRead,
  markAllOrgNotificationsRead,
  markMyNotificationRead,
  markOrgNotificationRead,
  myUnreadCount,
  orgUnreadCount,
  projectsOverview,
  searchContacts,
  searchProjects,
} from '../../api/workspace.ts';
import { chance, pick } from '../../data/random.ts';
import { searchTerm } from '../../data/work.ts';
import type { Journey } from './journey.ts';

/** Back to Home: every Home read again, then a look around. */
export const home: Journey = {
  name: 'browse.home',
  run: async (vu) => {
    vu.screen = 'home';
    vu.closeThread();
    await vu.homeReads();
    await vu.pause('read');
  },
};

/** Open the bell(s), read a notification, sometimes clear all. */
export const notifications: Journey = {
  name: 'browse.notifications',
  run: async (vu) => {
    const orgId = vu.orgId;
    const [mine, org] = await Promise.all([
      listMyNotifications(vu.api, orgId),
      listOrgNotifications(vu.api, orgId),
    ]);
    await vu.pause('read');
    const unreadMine = (mine.body ?? []).filter((row) => !row.read);
    const unreadOrg = (org.body ?? []).filter((row) => !row.read);
    const one = pick(vu.random, unreadMine);
    if (one !== undefined) {
      await markMyNotificationRead(vu.api, orgId, one.id);
      await vu.pause('click');
    }
    const orgOne = pick(vu.random, unreadOrg);
    if (orgOne !== undefined) {
      await markOrgNotificationRead(vu.api, orgId, orgOne.id);
      await vu.pause('click');
    }
    if (chance(vu.random, 0.3)) {
      await markAllMyNotificationsRead(vu.api, orgId);
      if (unreadOrg.length > 0)
        await markAllOrgNotificationsRead(vu.api, orgId);
    }
    await Promise.all([
      orgUnreadCount(vu.api, orgId),
      myUnreadCount(vu.api, orgId),
    ]);
  },
};

/** The org's shared project board, and a task opened from it. */
export const viewBoard: Journey = {
  name: 'browse.board',
  eligible: (vu) => vu.seat?.org.projectId !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    const projectId = vu.seat?.org.projectId;
    if (projectId === null || projectId === undefined) return;
    vu.closeThread();
    vu.screen = 'board';
    vu.boardProjectId = projectId;
    const board = await listProjectBoard(vu.api, orgId, projectId);
    const tasks = board.body ?? [];
    const memory = vu.memory();
    memory.boardTasks = tasks.slice(0, 40).map((task) => task.id);
    await vu.pause('read');
    const task = pick(vu.random, tasks.slice(0, 20));
    if (task === undefined) return;
    await Promise.all([
      getTask(vu.api, orgId, task.id),
      listTaskComments(vu.api, orgId, task.id),
      taskActivity(vu.api, orgId, task.id),
    ]);
    await vu.pause('read');
    if (chance(vu.random, 0.3)) {
      await listProjectBoard(vu.api, orgId, projectId, {
        query: searchTerm(vu.data, vu.random),
      });
    }
  },
};

/** The search boxes: chats, projects, the document hub. */
export const search: Journey = {
  name: 'browse.search',
  run: async (vu) => {
    const orgId = vu.orgId;
    const term = searchTerm(vu.data, vu.random);
    await vu.pause('type', 0.3);
    await searchThreads(vu.api, orgId, term);
    await vu.pause('click');
    await searchProjects(vu.api, orgId, term);
    await vu.pause('click');
    await searchHub(vu.api, orgId, term);
  },
};

/** The projects page and the hub's document list. */
export const browseProjects: Journey = {
  name: 'browse.projects',
  run: async (vu) => {
    vu.screen = 'other';
    await projectsOverview(vu.api, vu.orgId);
    await vu.pause('read');
    await listHubDocuments(vu.api, vu.orgId);
  },
};

/** The contact directory: list, then search it. */
export const browseContacts: Journey = {
  name: 'browse.contacts',
  run: async (vu) => {
    vu.screen = 'other';
    await listContacts(vu.api, vu.orgId);
    await vu.pause('read');
    await searchContacts(vu.api, vu.orgId, searchTerm(vu.data, vu.random));
  },
};

/** Settings pages opened and closed without a change. */
export const viewSettings: Journey = {
  name: 'browse.settings',
  run: async (vu) => {
    vu.screen = 'other';
    await Promise.all([currentUser(vu.api), userPreferences(vu.api, vu.orgId)]);
    await vu.pause('read');
  },
};

/** A person in two organizations switches to the other one. */
export const switchOrganization: Journey = {
  name: 'browse.switch-organization',
  eligible: (vu) => vu.otherSeat() !== null,
  run: async (vu) => {
    const other = vu.otherSeat();
    if (other === null) return;
    vu.metrics.counter('session.organization_switches');
    await vu.enterOrganization(other, vu.seat?.org.id);
    await vu.pause('read');
  },
};

/**
 * Personas as weighted journey mixes. Each persona also paces itself: an
 * `idle` factor stretches or shortens the pause between two journeys (a
 * reader lingers, an integration fires again soon).
 *
 * A journey a user cannot do right now (wrong role, option switched off,
 * nothing to work on) drops out of the draw; when nothing is left the user
 * looks at Home.
 */

import { pickWeighted } from '../data/random.ts';
import type { PersonaName } from './contract.ts';
import {
  apiKeyLifecycle,
  auditLog,
  members,
  teams,
  updateSettings,
} from './journeys/admin.ts';
import {
  browseContacts,
  browseProjects,
  home,
  notifications,
  search,
  switchOrganization,
  viewBoard,
  viewSettings,
} from './journeys/browse.ts';
import {
  chooseModel,
  continueConversation,
  newConversation,
  readConversation,
  tidyThreads,
} from './journeys/chat.ts';
import { fuzz } from './journeys/fuzz.ts';
import type { Journey } from './journeys/journey.ts';
import {
  searchDocuments,
  searchKnowledgeBase,
  uploadDocument,
} from './journeys/knowledge.ts';
import {
  restChat,
  restKnowledge,
  restTasks,
  restThreads,
} from './journeys/rest.ts';
import {
  addContact,
  commentTask,
  fileTask,
  newProject,
  workTask,
} from './journeys/work.ts';
import type { VirtualUser } from './user.ts';

export interface Persona {
  readonly name: PersonaName;
  readonly journeys: readonly (readonly [Journey, number])[];
  /** Multiplies the idle pause between journeys. */
  readonly idleFactor: number;
}

export const PERSONAS: Readonly<Record<PersonaName, Persona>> = {
  browser: {
    name: 'browser',
    idleFactor: 1.5,
    journeys: [
      [home, 28],
      [readConversation, 18],
      [notifications, 12],
      [viewBoard, 12],
      [newConversation, 7],
      [search, 6],
      [browseProjects, 4],
      [browseContacts, 3],
      [viewSettings, 3],
      [updateSettings, 1],
      [switchOrganization, 4],
    ],
  },
  chatter: {
    name: 'chatter',
    idleFactor: 0.8,
    journeys: [
      [newConversation, 40],
      [continueConversation, 28],
      [tidyThreads, 8],
      [home, 10],
      [notifications, 4],
      [chooseModel, 3],
      [search, 3],
      [switchOrganization, 4],
    ],
  },
  'task-worker': {
    name: 'task-worker',
    idleFactor: 1,
    journeys: [
      [workTask, 32],
      [fileTask, 20],
      [viewBoard, 16],
      [commentTask, 10],
      [home, 8],
      [notifications, 6],
      [addContact, 3],
      [browseContacts, 3],
      [newProject, 1],
      [newConversation, 3],
      [switchOrganization, 4],
    ],
  },
  knowledge: {
    name: 'knowledge',
    idleFactor: 1,
    journeys: [
      [uploadDocument, 22],
      [searchKnowledgeBase, 28],
      [searchDocuments, 14],
      [newConversation, 12],
      [browseProjects, 6],
      [home, 8],
      [addContact, 3],
      [browseContacts, 3],
      [switchOrganization, 4],
    ],
  },
  admin: {
    name: 'admin',
    idleFactor: 1.2,
    journeys: [
      [members, 18],
      [teams, 14],
      [auditLog, 18],
      [apiKeyLifecycle, 8],
      [updateSettings, 8],
      [addContact, 6],
      [newProject, 2],
      [home, 14],
      [notifications, 8],
      [switchOrganization, 4],
    ],
  },
  'api-client': {
    name: 'api-client',
    idleFactor: 0.4,
    journeys: [
      [restChat, 38],
      [restTasks, 32],
      [restKnowledge, 14],
      [restThreads, 16],
    ],
  },
  fuzzer: {
    name: 'fuzzer',
    idleFactor: 0.6,
    journeys: [
      [fuzz, 70],
      [home, 10],
      [newConversation, 5],
      [fileTask, 5],
      [search, 10],
    ],
  },
};

/** The next journey this user sets out on. */
export function nextJourney(vu: VirtualUser): Journey {
  const persona = PERSONAS[vu.persona];
  const eligible = persona.journeys.filter(
    ([journey]) => journey.eligible === undefined || journey.eligible(vu),
  );
  return pickWeighted(vu.random, eligible) ?? home;
}

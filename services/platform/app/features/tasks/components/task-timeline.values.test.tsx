import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskReadAdapters } from '@/app/lib/backend/tasks';
import { i18n } from '@/lib/i18n/i18n';
import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen } from '@/tests/utils/render';

import { TASK_STATUS_ORDER } from '../lib/display';
import type { TaskActivityRow } from '../utils/task-timeline';
import { TaskTimeline } from './task-timeline';

/**
 * The history reads each stored value as the field it belongs to. These rows
 * are the activity door's own answer (`GET /api/app/tasks/{id}/activity`: a
 * side the writer left out is `null`, a field it cleared is `''`), read through
 * the app's real adapter and rendered with the shipped catalogs and date
 * formats. Only the member names are a fixture.
 */

const timeline = vi.hoisted(() => ({ activity: [] as TaskActivityRow[] }));

vi.mock('../hooks/queries', () => ({
  useTaskActivity: () => ({ activity: timeline.activity }),
  useTaskAgentRuns: () => ({ runs: [] }),
}));

const MEMBERS: Record<string, string> = {
  'user-kim': 'Kim Lee',
  'user-alex': 'Alex Doe',
};

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name: MEMBERS[id] ?? id,
      isAgent: type === 'agent',
    }),
    resolveAssigneeId: (id: string) => MEMBERS[id] ?? id,
    resolveActorPreview: () => null,
    resolveAgentRunPreview: () => null,
    resolveWorkflowRunPreview: () => null,
  }),
}));

// Noon UTC, so the calendar day is the same in every test runner's zone.
const SEP_30 = String(Date.UTC(2026, 8, 30, 12));
const OCT_1 = String(Date.UTC(2026, 9, 1, 12));
const OCT_2 = String(Date.UTC(2026, 9, 2, 12));

type Wire = {
  action: string;
  fromValue: string | null;
  toValue: string | null;
};

function wire(
  action: string,
  fromValue: string | null,
  toValue: string | null,
): Wire {
  return { action, fromValue, toValue };
}

/** Read `rows` the way the task dialog does: the door's JSON through the
 * activity adapter, which keeps `''` and drops `null`. */
async function readNativeActivity(rows: Wire[]): Promise<TaskActivityRow[]> {
  vi.spyOn(window, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        activity: rows.map((row, index) => ({
          id: `activity-${index}`,
          organizationId: 'org-1',
          taskId: 'task-1',
          projectId: 'project-1',
          actorType: 'user',
          actorId: 'user-alex',
          createdAt: Date.UTC(2026, 9, 1, 9) - index * 60_000,
          ...row,
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  const read = taskReadAdapters['tasks/queries:listTaskActivity']?.(
    { organizationId: 'org-1', taskId: 'task-1' },
    {},
  );
  if (!read) throw new Error('no activity adapter');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter's projection is the row the timeline consumes
  return (await read.queryFn()) as TaskActivityRow[];
}

/** What each locale calls the fields and their empty values. */
const WORDS = {
  en: {
    dueDate: 'due date changed',
    startDate: 'start date changed',
    assignee: 'assignee changed',
    reviewer: 'reviewer changed',
    description: 'description changed',
    labels: 'labels changed',
    attachments: 'attachments changed',
    priority: 'priority changed',
    title: 'title changed',
    status: 'status changed',
    created: 'created',
    updated: 'updated',
    dependencyRemoved: 'dependency removed',
    noDueDate: 'No due date',
    noStartDate: 'No start date',
    unassigned: 'Unassigned',
    noReviewer: 'No reviewer',
    noDescription: 'No description',
    noLabels: 'No labels',
    noAttachments: 'No attachments',
    noPriority: 'No priority',
    urgent: 'Urgent',
    todo: 'To do',
    done: 'Done',
    sep30: '09/30/2026',
    oct1: '10/01/2026',
    oct2: '10/02/2026',
  },
  de: {
    dueDate: 'fälligkeitsdatum geändert',
    startDate: 'startdatum geändert',
    assignee: 'zuständigkeit geändert',
    reviewer: 'reviewer geändert',
    description: 'beschreibung geändert',
    labels: 'labels geändert',
    attachments: 'anhänge geändert',
    priority: 'priorität geändert',
    title: 'titel geändert',
    status: 'status geändert',
    created: 'erstellt',
    updated: 'aktualisiert',
    dependencyRemoved: 'abhängigkeit entfernt',
    noDueDate: 'Kein Fälligkeitsdatum',
    noStartDate: 'Kein Startdatum',
    unassigned: 'Nicht zugewiesen',
    noReviewer: 'Kein Reviewer',
    noDescription: 'Keine Beschreibung',
    noLabels: 'Keine Labels',
    noAttachments: 'Keine Anhänge',
    noPriority: 'Keine Priorität',
    urgent: 'Dringend',
    todo: 'Zu erledigen',
    done: 'Erledigt',
    sep30: '30.09.2026',
    oct1: '01.10.2026',
    oct2: '02.10.2026',
  },
  fr: {
    dueDate: 'échéance modifiée',
    startDate: 'date de début modifiée',
    assignee: 'responsable modifié',
    reviewer: 'relecteur modifié',
    description: 'description modifiée',
    labels: 'étiquettes modifiées',
    attachments: 'pièces jointes modifiées',
    priority: 'priorité modifiée',
    title: 'titre modifié',
    status: 'statut modifié',
    created: 'créé',
    updated: 'mis à jour',
    dependencyRemoved: 'dépendance supprimée',
    noDueDate: 'Aucune échéance',
    noStartDate: 'Aucune date de début',
    unassigned: 'Non assigné',
    noReviewer: 'Aucun relecteur',
    noDescription: 'Aucune description',
    noLabels: 'Aucune étiquette',
    noAttachments: 'Aucune pièce jointe',
    noPriority: 'Aucune priorité',
    urgent: 'Urgent',
    todo: 'À faire',
    done: 'Terminé',
    sep30: '30/09/2026',
    oct1: '01/10/2026',
    oct2: '02/10/2026',
  },
} as const satisfies Record<ShippedLocale, Record<string, string>>;

async function renderHistory(locale: ShippedLocale, rows: Wire[]) {
  saveLocale(locale);
  await i18n.changeLanguage(locale);
  timeline.activity = await readNativeActivity(rows);
  render(
    <TaskTimeline
      taskId="task-1"
      organizationId="org-1"
      projectId="project-1"
    />,
  );
}

/** One history line, as the reader sees it: the change, then what it was. */
const line = (label: string, detail?: string) =>
  detail === undefined ? label : `${label}: ${detail}`;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete window.__ENV__;
  timeline.activity = [];
  await forgetSavedLocale();
});

describe.each(SHIPPED_LOCALES)('Task history in %s', (locale) => {
  const w = WORDS[locale];

  // #3750: a cleared field names its absence instead of repeating the value
  // it had; setting one names the absence it replaced.
  it('names a cleared field, and the empty field a value replaced', async () => {
    await renderHistory(locale, [
      wire('dueDate.changed', '', SEP_30),
      wire('dueDate.changed', SEP_30, OCT_1),
      wire('dueDate.changed', OCT_1, ''),
      wire('startDate.changed', SEP_30, ''),
      wire('assignee.changed', null, 'user-alex'),
      wire('assignee.changed', 'user-kim', null),
      wire('reviewer.changed', 'user-kim', ''),
      wire('description.changed', 'Timeline literal original', ''),
      wire('labels.changed', 'Bug, Feature', ''),
      wire('attachments.changed', 'brief.pdf', ''),
      wire('priority.changed', 'p0', ''),
    ]);

    for (const expected of [
      line(w.dueDate, `${w.noDueDate} → ${w.sep30}`),
      line(w.dueDate, `${w.sep30} → ${w.oct1}`),
      line(w.dueDate, `${w.oct1} → ${w.noDueDate}`),
      line(w.startDate, `${w.sep30} → ${w.noStartDate}`),
      line(w.assignee, `${w.unassigned} → Alex Doe`),
      line(w.assignee, `Kim Lee → ${w.unassigned}`),
      line(w.reviewer, `Kim Lee → ${w.noReviewer}`),
      line(w.description, `Timeline literal original → ${w.noDescription}`),
      line(w.labels, `Bug, Feature → ${w.noLabels}`),
      line(w.attachments, `brief.pdf → ${w.noAttachments}`),
      line(w.priority, `${w.urgent} → ${w.noPriority}`),
    ]) {
      expect(await screen.findByText(expected)).toBeInTheDocument();
    }
  });

  // #3751: what a person typed stays exactly as typed, even when it spells a
  // status, a priority or a refusal code; the real enums still read as words.
  it('keeps typed text literal and translates only the real enums', async () => {
    await renderHistory(locale, [
      wire('title.changed', 'todo', 'done'),
      ...TASK_STATUS_ORDER.map((status) =>
        wire('title.changed', `Draft ${status}`, status),
      ),
      ...TASK_STATUS_ORDER.map((status) =>
        wire('labels.changed', 'Bug', status),
      ),
      wire('description.changed', 'Timeline literal original', 'backlog'),
      wire('attachments.changed', '', 'done'),
      wire('title.changed', 'p0', 'agent_disabled'),
      wire('status.changed', 'todo', 'done'),
      wire('created', null, 'todo'),
    ]);

    for (const expected of [
      line(w.title, 'todo → done'),
      ...TASK_STATUS_ORDER.map((status) =>
        line(w.title, `Draft ${status} → ${status}`),
      ),
      ...TASK_STATUS_ORDER.map((status) => line(w.labels, `Bug → ${status}`)),
      line(w.description, 'Timeline literal original → backlog'),
      line(w.attachments, `${w.noAttachments} → done`),
      line(w.title, 'p0 → agent_disabled'),
      line(w.status, `${w.todo} → ${w.done}`),
      line(w.created, w.todo),
    ]) {
      expect(await screen.findByText(expected)).toBeInTheDocument();
    }
  });

  // An end the writer never recorded is not a cleared one: nothing is
  // invented for it, and a row that carries no values reads as its action.
  it('invents nothing for a value that was never recorded', async () => {
    await renderHistory(locale, [
      wire('dueDate.changed', OCT_2, null),
      wire('dependency.removed', 'task-blocker', null),
      wire('updated', null, null),
      wire('custom.changed', null, 'done'),
    ]);

    expect(
      await screen.findByText(line(w.dueDate, w.oct2)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(line(w.dependencyRemoved, 'task-blocker')),
    ).toBeInTheDocument();
    expect(screen.getByText(line(w.updated))).toBeInTheDocument();
    // An action this build does not know keeps its raw name and its value.
    expect(
      screen.getByText(line('custom.changed', 'done')),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(w.noDueDate))).not.toBeInTheDocument();
  });
});

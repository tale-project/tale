import type { ProjectDispatchRole } from '@tale/shared/schemas/project-dispatch';

import {
  decideDue,
  nextOccurrence,
  scheduleOfTrigger,
  type Schedule,
} from '../../../lib/automations/schedule/occurrences.ts';

/**
 * Standing roles as data: an agent started on its own task on a schedule
 * read in the role's time zone (`ProjectDispatchRole`). Pure: the pass
 * (`dispatch-pass.ts`) records each decided occurrence under its key, so an
 * occurrence decided twice — a pass delivered again, two passes racing —
 * starts the agent once.
 *
 * An occurrence fires only on time: within the schedule's ten-minute grace,
 * never as a burst of what an outage missed. An occurrence that finds the
 * role's task still worked on is coalesced into that run.
 */

/** A role's schedule, or why it has none (an unreadable cron or zone, which
 * the save refuses; a document a newer image wrote can still carry one). */
export function roleSchedule(
  role: ProjectDispatchRole,
): Schedule | { issue: string } {
  const result = scheduleOfTrigger({
    cron: role.cron,
    timezone: role.timezone,
    scheduleRule: null,
  });
  return 'issue' in result ? result : result.schedule;
}

export interface DueRoleOccurrence {
  role: ProjectDispatchRole;
  /** The occurrence, epoch ms. */
  occurrenceAt: number;
  /** The occurrence in the role's zone and as the UTC instant. */
  label: string;
}

/**
 * The occurrences of the roles that are due now: for each role, the latest
 * occurrence after its newest decided one (or after the dispatch was saved,
 * for a role with none) when it is no more than the grace late.
 */
export function dueRoleOccurrences(
  roles: readonly ProjectDispatchRole[],
  args: {
    /** The newest decided occurrence per role key. */
    handled: ReadonlyMap<string, number>;
    /** Where a role with no decided occurrence starts from: when the
     * dispatch was saved, so a role added later fires nothing earlier. */
    since: number;
    now: number;
  },
): DueRoleOccurrence[] {
  const due: DueRoleOccurrence[] = [];
  for (const role of roles) {
    const schedule = roleSchedule(role);
    if ('issue' in schedule) continue;
    const handledThrough = args.handled.get(role.key) ?? args.since;
    const decision = decideDue(
      schedule,
      handledThrough,
      handledThrough,
      args.now,
      'skip',
    );
    if (decision.fire === null) continue;
    due.push({
      role,
      occurrenceAt: decision.fire,
      label: occurrenceLabel(role, decision.fire),
    });
  }
  return due;
}

/** The role's next occurrence after `now`, or null when its schedule has
 * none (or does not read). */
export function nextRoleOccurrence(
  role: ProjectDispatchRole,
  now: number,
): number | null {
  const schedule = roleSchedule(role);
  if ('issue' in schedule) return null;
  return nextOccurrence(schedule, now);
}

/** `<key> <YYYY-MM-DD HH:mm> <zone> (<UTC instant>)`: the wall-clock time
 * a person in the role's zone reads, and the instant that tells apart the
 * two occurrences of an hour the clock repeats. */
export function occurrenceLabel(
  role: Pick<ProjectDispatchRole, 'key' | 'timezone'>,
  at: number,
): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: role.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const wall = `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
  return `${role.key} ${wall} ${role.timezone} (${new Date(at).toISOString()})`;
}

/** What the role's agent addresses first on an occurrence: the occurrence,
 * the role's mode, and its brief. The task's description and the project's
 * instructions reach the run on their own, as they stand when it starts. */
export function roleOccurrenceFeedback(
  role: ProjectDispatchRole,
  label: string,
): string {
  return [
    `Scheduled occurrence: ${label}.${role.mode !== undefined ? ` Mode: ${role.mode}.` : ''}`,
    ...(role.brief !== undefined ? [role.brief] : []),
  ].join('\n\n');
}

/** The id the run of a role's occurrence records as what started it. */
export function roleOccurrenceId(
  roleKey: string,
  occurrenceAt: number,
): string {
  return `${roleKey}@${occurrenceAt}`;
}

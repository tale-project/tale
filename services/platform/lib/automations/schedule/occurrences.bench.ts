/**
 * What one occurrence walk costs, shape by shape — a note, not a gate: the
 * budget is under a millisecond per call for every shape, since the scan
 * asks once per due row and the preview five times per edit. Run it with
 * `bunx vitest bench --project server lib/automations/schedule/occurrences.bench.ts`.
 */

import { bench, describe } from 'vitest';

import { parseCron } from '../cron.ts';
import {
  decideDue,
  nextOccurrence,
  type Schedule,
  upcomingOccurrences,
} from './occurrences.ts';

const START = { year: 2026, month: 1, day: 1 };
const AFTER = Date.UTC(2026, 9, 24, 23, 0);

const shapes: [string, Schedule][] = [
  [
    'daily, three times, Zurich',
    {
      type: 'rule',
      rule: {
        frequency: 'daily',
        interval: 1,
        times: ['02:30', '09:00', '17:30'],
      },
      timezone: 'Europe/Zurich',
      startDate: START,
    },
  ],
  [
    'yearly/99 on February 29',
    {
      type: 'rule',
      rule: {
        frequency: 'yearly',
        interval: 99,
        month: 2,
        monthDay: 29,
        times: ['09:00'],
      },
      timezone: 'America/New_York',
      startDate: START,
    },
  ],
  [
    'every 15 minutes, overnight window, Zurich',
    {
      type: 'rule',
      rule: {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [6], hours: { from: '22:00', to: '06:00' } },
      },
      timezone: 'Europe/Zurich',
      startDate: START,
    },
  ],
  [
    'cron 0 0 29 2 *',
    {
      type: 'cron',
      cron: parseCron('0 0 29 2 *'),
      timezone: 'UTC',
      dstClass: 'named',
    },
  ],
  [
    'cron */5 9-17 * * 1-5, Lord Howe',
    {
      type: 'cron',
      cron: parseCron('*/5 9-17 * * 1-5'),
      timezone: 'Australia/Lord_Howe',
      dstClass: 'grid',
    },
  ],
];

for (const [name, schedule] of shapes) {
  describe(name, () => {
    bench('nextOccurrence', () => {
      nextOccurrence(schedule, AFTER);
    });
    bench('upcomingOccurrences ×5', () => {
      upcomingOccurrences(schedule, AFTER, 5);
    });
    bench('decideDue, a day late', () => {
      decideDue(schedule, AFTER - 86_400_000, 0, AFTER, 'latest');
    });
  });
}

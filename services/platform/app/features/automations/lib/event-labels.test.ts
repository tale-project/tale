import { describe, expect, it } from 'vitest';

import { EMITTED_EVENT_TYPES } from '@/lib/shared/event-types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  EVENT_GROUPS,
  eventGroupLabel,
  eventsOf,
  eventWords,
} from './event-labels';

describe('event labels', () => {
  it('puts every event the platform raises in exactly one group', () => {
    const listed = EVENT_GROUPS.flatMap((group) => eventsOf(group));
    expect(listed.toSorted()).toEqual([...EMITTED_EVENT_TYPES].toSorted());
  });

  it('lists the task events first, in the vocabulary’s order', () => {
    expect(eventsOf('tasks')).toEqual(['task.created', 'task.status_changed']);
  });

  it.each(['en', 'de', 'fr'])(
    'names every event and group in %s, never by its key',
    (locale) => {
      const t = i18n.getFixedT(locale, 'automations');
      for (const group of EVENT_GROUPS) {
        expect(eventGroupLabel(group, t)).not.toMatch(/^trigger\./);
      }
      for (const type of EMITTED_EVENT_TYPES) {
        const { label, description } = eventWords(type, t);
        expect(label).not.toMatch(/^trigger\./);
        expect(description).toMatch(/[.!?]$/);
      }
    },
  );

  it('says when a task is created in plain words', () => {
    const t = i18n.getFixedT('en', 'automations');
    expect(eventWords('task.created', t)).toEqual({
      label: 'Task created',
      description:
        'A task is created on a board, through the API or by an import.',
    });
  });
});

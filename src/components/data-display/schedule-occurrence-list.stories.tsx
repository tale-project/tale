import type { Meta, StoryObj } from '@storybook/react';

import type { ScheduleOccurrence } from '../../lib/recurrence/schedule';
import { ScheduleOccurrenceList } from './schedule-occurrence-list';

/** 09:00 in Zurich, Tuesday to Saturday, Oct 13–17, 2026. */
const WEEK: ScheduleOccurrence[] = [13, 14, 15, 16, 17].map((day) => ({
  at: Date.UTC(2026, 9, day, 7, 0),
  timeZone: 'Europe/Zurich',
}));

/** The Zurich clock changes of 2026, as a host marks them. */
const CLOCK_CHANGES: ScheduleOccurrence[] = [
  {
    at: Date.UTC(2026, 2, 29, 1, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'shiftedForward', wallTime: '02:30' },
  },
  {
    at: Date.UTC(2026, 9, 25, 0, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: false },
  },
  {
    at: Date.UTC(2026, 9, 25, 1, 15),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: true },
  },
];

const meta: Meta<typeof ScheduleOccurrenceList> = {
  title: 'Data Display/ScheduleOccurrenceList',
  component: ScheduleOccurrenceList,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The next starts of a schedule, written in the schedule's zone, with the
reader's own time where their zone differs and a visible note on a clock
change. The host computes the starts; the list does no zone arithmetic.

\`\`\`tsx
import { ScheduleOccurrenceList } from '@tale/ui/schedule-occurrence-list';

<ScheduleOccurrenceList occurrences={upcoming} referenceYear={2026} />
\`\`\`
        `,
      },
    },
  },
  args: { referenceYear: 2026 },
};

export default meta;
type Story = StoryObj<typeof ScheduleOccurrenceList>;

export const Compact: Story = {
  args: {
    occurrences: WEEK,
    variant: 'compact',
    count: 3,
    viewerTimeZone: 'America/New_York',
  },
  render: (args) => (
    <div className="w-72">
      <ScheduleOccurrenceList {...args} />
    </div>
  ),
};

export const FullWithViewerZone: Story = {
  args: { occurrences: WEEK, viewerTimeZone: 'America/New_York' },
  render: (args) => (
    <div className="w-96">
      <ScheduleOccurrenceList {...args} />
    </div>
  ),
};

export const ClockChange: Story = {
  args: { occurrences: CLOCK_CHANGES, viewerTimeZone: 'Europe/Zurich' },
  render: (args) => (
    <div className="w-96">
      <ScheduleOccurrenceList {...args} />
    </div>
  ),
};

export const Muted: Story = {
  args: {
    occurrences: WEEK,
    muted: true,
    label: 'Would run at',
    viewerTimeZone: 'Europe/Zurich',
  },
  render: (args) => (
    <div className="w-96">
      <ScheduleOccurrenceList {...args} />
    </div>
  ),
};

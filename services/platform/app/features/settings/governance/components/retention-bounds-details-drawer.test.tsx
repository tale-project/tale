import { AppShell } from '@tale/ui/app-shell';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  type DiffEntry,
  type ImpactEntry,
  RetentionBoundsDetailsDrawer,
} from './retention-bounds-details-drawer';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

async function open(
  language: string,
  diff: DiffEntry[],
  impactPreview: ImpactEntry[] = [],
) {
  await i18n.changeLanguage(language);
  render(
    <AppShell i18n={i18n}>
      <RetentionBoundsDetailsDrawer
        open
        onOpenChange={() => undefined}
        diff={diff}
        impactPreview={impactPreview}
      />
    </AppShell>,
  );
  return screen.getByRole('dialog');
}

const rows = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll('li')).map(
    (item) => item.textContent?.replaceAll(' ', ' ') ?? '',
  );

// What a person reads for each language: the category as the retention
// editor titles it, which side of the range changes, the value with its unit,
// and what the change does to retention. The id, `min` and `tighten` are
// the wire's words and never reach the screen.
const WORDS = {
  en: {
    title: 'Automation versions',
    min: 'minimum',
    max: 'maximum',
    none: 'no limit',
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`,
    tighten: 'tightens retention',
    loosen: 'loosens retention',
    colon: ':',
  },
  de: {
    title: 'Automatisierungsversionen',
    min: 'Minimum',
    max: 'Maximum',
    none: 'keine Grenze',
    days: (n: number) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'Stunde' : 'Stunden'}`,
    tighten: 'verschärft die Aufbewahrung',
    loosen: 'lockert die Aufbewahrung',
    colon: ':',
  },
  fr: {
    title: "Versions d'automatisation",
    min: 'minimum',
    max: 'maximum',
    none: 'aucune limite',
    days: (n: number) => `${n} ${n === 1 ? 'jour' : 'jours'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'heure' : 'heures'}`,
    tighten: 'resserre la rétention',
    loosen: 'assouplit la rétention',
    colon: ' :',
  },
} as const;

describe('RetentionBoundsDetailsDrawer', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'names the category, the side, the unit and the effect in words (%s)',
    async (language) => {
      const w = WORDS[language];
      const dialog = await open(
        language,
        [
          {
            category: 'automationVersions',
            field: 'min',
            from: null,
            to: 90,
            direction: 'tighten',
          },
          {
            category: 'userTempHours',
            field: 'max',
            from: 48,
            to: 24,
            direction: 'tighten',
          },
          {
            category: 'userTempHours',
            field: 'min',
            from: 12,
            to: 1,
            direction: 'loosen',
          },
          {
            category: 'automationVersions',
            field: 'max',
            from: 365,
            to: null,
            direction: 'loosen',
          },
        ],
        [
          {
            category: 'automationVersions',
            field: 'automationVersionsRetentionDays',
            current: 30,
            willClampTo: 90,
          },
        ],
      );
      const text = rows(dialog);
      expect(text).toContain(
        `${w.title}, ${w.min}${w.colon} ${w.none} → ${w.days(90)} (${w.tighten})`,
      );
      expect(text).toContain(
        `${w.title}, ${w.max}${w.colon} ${w.days(365)} → ${w.none} (${w.loosen})`,
      );
      // Hours where the category keeps hours, singular where it is one.
      expect(
        text.some(
          (row) =>
            row.includes(w.hours(48)) &&
            row.includes(w.hours(24)) &&
            row.includes(w.max),
        ),
      ).toBe(true);
      expect(
        text.some((row) => row.includes(w.hours(1)) && row.includes(w.loosen)),
      ).toBe(true);
      // The impact row reads the same way.
      expect(
        text.some(
          (row) =>
            row.startsWith(`${w.title}${w.colon} `) &&
            row.includes(w.days(30)) &&
            row.includes(w.days(90)),
        ),
      ).toBe(true);
      // None of the wire's words is left on screen.
      const all = text.join(' | ');
      expect(all).not.toMatch(/automationVersions|userTempHours/);
      expect(all).not.toMatch(/\btighten\b|\bloosen\b|\bmin\b|\bmax\b/);
      expect(all).not.toContain('—');
    },
  );

  it('keeps the id of a category this build does not know and counts it in days', async () => {
    const dialog = await open('en', [
      {
        category: 'somethingNew',
        field: 'max',
        from: 30,
        to: 7,
        direction: 'tighten',
      },
    ]);
    expect(rows(dialog)).toEqual([
      'somethingNew, maximum: 30 days → 7 days (tightens retention)',
    ]);
  });
});

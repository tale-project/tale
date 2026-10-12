import { AppShell } from '@tale/ui/app-shell';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RetentionCategory } from '@/lib/shared/schemas/retention';
import { i18n } from '@/tests/utils/i18n-all-languages';

import type { CategoryBounds } from '../hooks/use-retention-bounds';
import { WIRE_MAPPING } from './retention-categories';
import { RetentionEditDrawer } from './retention-edit-drawer';
import { RetentionPolicySummary } from './retention-policy-summary';

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertRetentionPolicy: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

const NO_ENV = { envName: '', source: 'none', applied: false } as const;
const bound = (
  min: number,
  max: number,
  unit: 'days' | 'hours',
  source: 'file' | 'env' = 'file',
): CategoryBounds => ({
  min,
  max,
  default: max,
  unit,
  source,
  minEnv: NO_ENV,
  maxEnv: NO_ENV,
  defaultEnv: NO_ENV,
});

const BOUNDS = new Map<RetentionCategory, CategoryBounds>([
  ['documents', bound(1, 3650, 'days')],
  ['userTempHours', bound(1, 720, 'hours', 'env')],
  ['automationVersions', bound(90, 3650, 'days')],
]);

// The words a person reads in each language for the same facts: a value with
// its unit (singular and plural), the range the operator allows, and whether
// a category's cleanup is on.
const WORDS = {
  en: {
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`,
    on: 'enabled',
    off: 'disabled',
    allowed: (min: number, max: number, unit: string) =>
      `Allowed: ${min}–${max} ${unit}.`,
    capped: (min: number, max: number, unit: string) =>
      `Operator caps this at ${min}-${max} ${unit}.`,
    daysUnit: 'days',
    hoursUnit: 'hours',
  },
  de: {
    days: (n: number) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'Stunde' : 'Stunden'}`,
    on: 'aktiviert',
    off: 'deaktiviert',
    allowed: (min: number, max: number, unit: string) =>
      `Erlaubt: ${min}–${max} ${unit}.`,
    capped: (min: number, max: number, unit: string) =>
      `Operator beschränkt dies auf ${min}-${max} ${unit}.`,
    daysUnit: 'Tage',
    hoursUnit: 'Stunden',
  },
  fr: {
    days: (n: number) => `${n} ${n === 1 ? 'jour' : 'jours'}`,
    hours: (n: number) => `${n} ${n === 1 ? 'heure' : 'heures'}`,
    on: 'activé',
    off: 'désactivé',
    allowed: (min: number, max: number, unit: string) =>
      `Autorisé : ${min}–${max} ${unit}.`,
    capped: (min: number, max: number, unit: string) =>
      `L'opérateur limite cette valeur à ${min}-${max} ${unit}.`,
    daysUnit: 'jours',
    hoursUnit: 'heures',
  },
} as const;

const plain = (text: string | null | undefined): string =>
  (text ?? '').replaceAll(' ', ' ').replaceAll(' ', ' ');

describe('the retention surfaces speak the language of the page', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'writes a stored value with its unit in the summary (%s)',
    async (language) => {
      const w = WORDS[language];
      await i18n.changeLanguage(language);
      const t = i18n.getFixedT(language, 'governance');
      render(
        <AppShell i18n={i18n}>
          <RetentionPolicySummary
            config={{
              documentsEnabled: true,
              documentsRetentionDays: 1,
              userTempEnabled: true,
              userTempRetentionHours: 24,
              automationVersionsEnabled: true,
              automationVersionsRetentionDays: 365,
            }}
            bounds={BOUNDS}
          />
        </AppShell>,
      );
      const valueOf = (key: string): string => {
        const title = screen.getByText(t(`retentionPolicy.${key}.title`));
        return plain(title.closest('div')?.querySelector('dd')?.textContent);
      };
      expect(valueOf('documents')).toBe(w.days(1));
      expect(valueOf('userTemp')).toBe(w.hours(24));
      expect(valueOf('automationVersions')).toBe(w.days(365));
    },
  );

  it.each(['en', 'de', 'fr'] as const)(
    'writes the range, the values and the state of a change in words (%s)',
    async (language) => {
      const w = WORDS[language];
      await i18n.changeLanguage(language);
      const t = i18n.getFixedT(language, 'governance');
      const user = userEvent.setup();
      render(
        <AppShell i18n={i18n}>
          <RetentionEditDrawer
            open
            onOpenChange={() => undefined}
            savedConfig={{
              documentsEnabled: true,
              documentsRetentionDays: 90,
              userTempEnabled: true,
              userTempRetentionHours: 24,
              automationVersionsEnabled: false,
              automationVersionsRetentionDays: 3650,
            }}
            bounds={BOUNDS}
            organizationId="org-1"
            cannotManage={false}
          />
        </AppShell>,
      );
      // The range under a field, from the operator's file and from its env.
      const drawer = screen.getByRole('dialog');
      // A field's help is the category's own sentence, then the range.
      const helpers = Array.from(drawer.querySelectorAll('p, span, div')).map(
        (node) => plain(node.textContent),
      );
      expect(
        helpers.some((text) => text.endsWith(w.allowed(1, 3650, w.daysUnit))),
      ).toBe(true);
      expect(
        helpers.some((text) => text.endsWith(w.capped(1, 720, w.hoursUnit))),
      ).toBe(true);

      // A change: documents 90 → 30 days, temporary files 24 → 1 hour, and
      // the automation versions' cleanup switched on.
      const switches = screen.getAllByRole('switch');
      const withSwitch = WIRE_MAPPING.filter((wire) => wire.enabledKey);
      const versions = withSwitch.findIndex(
        (wire) => wire.id === 'automationVersions',
      );
      await user.click(switches[versions] as HTMLElement);
      const numbers = screen.getAllByRole('spinbutton');
      fireEvent.change(numbers[0] as HTMLElement, { target: { value: '30' } });
      fireEvent.change(numbers[1] as HTMLElement, { target: { value: '1' } });
      await user.click(
        within(drawer).getByRole('button', {
          name: t('retentionPolicy.save'),
        }),
      );
      const confirm = await screen.findByRole('dialog', {
        name: t('retentionPolicy.diff.title'),
      });
      const rows = Array.from(confirm.querySelectorAll('li')).map((item) =>
        plain(item.textContent),
      );
      expect(rows).toContain(
        `${t('retentionPolicy.documents.title')}${w.days(90)} → ${w.days(30)}`,
      );
      expect(rows).toContain(
        `${t('retentionPolicy.userTemp.title')}${w.hours(24)} → ${w.hours(1)}`,
      );
      expect(rows).toContain(
        `${t('retentionPolicy.automationVersions.title')}${w.off} → ${w.on}`,
      );
    },
  );
});

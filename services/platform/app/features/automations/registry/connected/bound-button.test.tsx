import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { BoundButton, EffectButton } from './bound-button';

// German locale so the pack `i18n.de.*` overrides are the expected output.
// Partial mock: the shared render helper needs the real LocaleProvider.
vi.mock('@tale/ui/i18n/locale-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/locale-provider')>()),
  useLocale: () => ({ locale: 'de', setLocale: () => {} }),
}));

// Platform catalog lookup echoes the key with its defaultValue fallback —
// mirrors the real `t(key, { defaultValue })` shape for non-catalog literals.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}));

vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: () => ({ dispatch: vi.fn(), isPending: false }),
}));

vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => vi.fn(),
}));

vi.mock('./task-comment-feedback-button', () => ({
  hasTaskCommentFeedback: () => false,
  TaskCommentFeedbackButton: () => null,
}));

describe('action label i18n (pack `i18n.<locale>` overrides)', () => {
  it('EffectButton renders the locale override over the English literal', () => {
    render(
      <EffectButton
        action={{
          label: 'Open Knowledge',
          i18n: { de: { label: 'Wissen öffnen' } },
          effect: { kind: 'toast', titleKey: 'x' },
        }}
        item={{}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Wissen öffnen' }),
    ).toBeInTheDocument();
  });

  it('BoundButton resolves label and confirm copy for the active locale', async () => {
    render(
      <BoundButton
        action={{
          label: 'Cancel',
          i18n: { de: { label: 'Abbrechen' } },
          path: 'tasks/public_actions:cancelTaskWorkflow',
          mode: 'action',
          confirm: {
            title: 'Cancel this return?',
            description: 'Stops the in-flight run.',
            i18n: {
              de: {
                title: 'Diese Abrechnung abbrechen?',
                description: 'Stoppt den laufenden Lauf.',
              },
            },
          },
        }}
        item={{ _id: 't1' }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Abbrechen' });
    button.click();
    expect(
      await screen.findByText('Diese Abrechnung abbrechen?'),
    ).toBeInTheDocument();
    expect(screen.getByText('Stoppt den laufenden Lauf.')).toBeInTheDocument();
  });

  it('falls back to the English literal for an uncovered locale', () => {
    render(
      <EffectButton
        action={{
          label: 'Open Knowledge',
          i18n: { fr: { label: 'Ouvrir Connaissances' } },
          effect: { kind: 'toast', titleKey: 'x' },
        }}
        item={{}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Open Knowledge' }),
    ).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { LlmModelSwapDialog } from './llm-model-swap-dialog';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4765: a failed read of the composer roster left Use another model in all
// steps with a With picker that said "No models found" and a Use this model
// that stayed off without a reason, with no way to try again. The read runs
// for real here (hook, adapter row, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport.

const ROSTER = /^GET \/api\/app\/chat\/composer\/models\?orgId=org-1$/;

function served(id: string, label: string, providerLabel: string) {
  return {
    id,
    label,
    providerSlug: providerLabel.toLowerCase(),
    providerLabel,
    credential: { authMethod: 'api-key' },
  };
}

const MODELS = [
  served('anthropic/claude-haiku-4-5', 'Claude Haiku 4.5', 'Anthropic'),
  served('gpt-5-mini', 'GPT-5 mini', 'OpenAI'),
  served('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'Google'),
];

/** A healthy answer: the models the organization's providers serve. */
function roster(models: object[] = MODELS): Response {
  return Response.json({
    models,
    harnesses: [],
    voice: { ttsAvailable: false, transcriptionAvailable: false },
  });
}

/** What the app door answers when its handler throws (`appErrorHandler`). */
function internalError(): Response {
  return new Response('Internal Server Error', { status: 500 });
}

/** The failure as each shipped locale words it. */
const FAILED = {
  en: "Couldn't load the models.",
  de: 'Die Modelle konnten nicht geladen werden.',
  fr: 'Impossible de charger les modèles.',
} as const;

const DOCUMENT = {
  version: 1,
  name: 'github/triage-issues',
  nodes: [
    { id: 'score_issue', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
    { id: 'summary', type: 'llm', model: 'gpt-5-mini' },
    { id: 'draft_reply', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
  ],
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  // Unmount before the language is put back, so no mounted label re-renders
  // outside act.
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

/** The dialog as the editor opens it from Change model. */
async function renderDialog() {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <LlmModelSwapDialog
        open
        onOpenChange={onOpenChange}
        organizationId="org-1"
        document={DOCUMENT}
        onApply={onApply}
      />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return { ...view, onApply, onOpenChange };
}

const t = (key: string) => i18n.t(key, { ns: 'automations' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const noModels = () =>
  screen.queryByText(i18n.t('agents.modelSearchEmpty', { ns: 'projects' }));
const dialog = () =>
  screen.getByRole('dialog', { name: t('editor.modelSwap.title') });
const useThisModel = () =>
  within(dialog()).getByRole('button', { name: t('editor.modelSwap.apply') });

/** The With picker's trigger, named by its label. */
function withPicker(): HTMLElement {
  const label = within(dialog()).getByText(t('editor.modelSwap.to'), {
    selector: 'label',
  });
  const trigger = document.getElementById(label.getAttribute('for') ?? '');
  if (trigger === null) throw new Error('No With picker');
  return trigger;
}

/** The alert in the dialog that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (
    await within(dialog()).findByText(message)
  ).closest<HTMLElement>('[role="alert"]');
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe(
  'LlmModelSwapDialog when the model roster read fails',
  { timeout: 30_000 },
  () => {
    it('names the failure under With with Try again, never "No models found", and says why Use this model stays off', async () => {
      backend.on(ROSTER, () => internalError());
      const { user, onApply } = await renderDialog();

      // The policy's four attempts, then a settled failure.
      await waitFor(() => expect(backend.count(ROSTER)).toBe(4));
      await waitFor(() => expect(client.isFetching()).toBe(0));

      const alert = await alertSaying(FAILED.en);
      expect(alert).toContainElement(
        within(dialog()).getByRole('button', { name: tryAgain() }),
      );
      // With offers no list that could say nothing is served.
      expect(withPicker()).toBeDisabled();
      await user.click(withPicker());
      expect(noModels()).not.toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();

      // Use this model stays off, and says why to a pointer and a keyboard.
      const apply = useThisModel();
      expect(apply).toHaveAttribute('aria-disabled', 'true');
      apply.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(FAILED.en);
      await user.click(apply);
      expect(onApply).not.toHaveBeenCalled();

      // The steps the swap would change are still listed.
      expect(
        within(
          within(dialog()).getByRole('list', {
            name: t('editor.modelSwap.steps'),
          }),
        )
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Score issue', 'Draft reply']);
    });

    it('lists the models when Try again works from the keyboard, hands the focus to With, and swaps', async () => {
      backend.on(ROSTER, () => internalError());
      const { user, onApply, onOpenChange } = await renderDialog();
      const alert = await alertSaying(FAILED.en);

      backend.on(ROSTER, () => roster());
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');

      // The Try again that held the focus is gone: the focus is on With,
      // not parked on the dialog.
      await waitFor(() => expect(withPicker()).toHaveFocus());
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
      expect(withPicker()).toBeEnabled();
      expect(backend.count(ROSTER)).toBe(5);

      await user.click(withPicker());
      // The model being replaced is no choice to replace it with.
      expect(
        screen.queryByRole('option', { name: /Claude Haiku 4.5/ }),
      ).not.toBeInTheDocument();
      await user.click(
        screen.getByRole('option', { name: /Gemini 3.5 Flash Lite/ }),
      );
      expect(useThisModel()).toBeEnabled();
      expect(useThisModel()).not.toHaveAttribute('aria-disabled');
      await user.click(useThisModel());
      expect(onApply).toHaveBeenCalledWith(
        'anthropic/claude-haiku-4-5',
        'gemini-3.5-flash-lite',
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('keeps Try again, and the focus on it, while it runs and when it fails again', async () => {
      backend.on(ROSTER, () => internalError());
      const { user } = await renderDialog();
      const alert = await alertSaying(FAILED.en);
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        ROSTER,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      retry.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(alert.closest('[aria-busy="true"]')).toBeNull();
      expect(useThisModel()).toHaveAttribute('aria-disabled', 'true');

      backend.on(ROSTER, () => internalError());
      answer(internalError());
      await waitFor(() => expect(backend.count(ROSTER)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(
        within(dialog()).getByText(FAILED.en).closest('[role="alert"]'),
      ).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
      expect(withPicker()).toBeDisabled();
      expect(noModels()).not.toBeInTheDocument();
    });

    it('keeps "No models found" for a roster that answered with none', async () => {
      backend.on(ROSTER, () => roster([]));
      const { user } = await renderDialog();
      await waitFor(() => expect(withPicker()).toBeEnabled());

      await user.click(withPicker());
      expect(noModels()).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // Nothing failed, so Use this model is simply off, with no reason.
      expect(useThisModel()).toBeDisabled();
      expect(backend.count(ROSTER)).toBe(1);
    });

    it.each(SHIPPED_LOCALES)(
      'names the failure in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(ROSTER, () => internalError());
        const { baseElement } = await renderDialog();

        const alert = await alertSaying(FAILED[locale]);
        expect(alert).toContainElement(
          within(dialog()).getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(baseElement);
      },
    );
  },
);

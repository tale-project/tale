import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
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
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { LlmModelField } from './llm-model-field';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4765: a failed read of the composer roster left an llm step's Model
// picker opening on "No models found" — a verdict about what the
// organization serves that the page never established, with no way to try
// again. The read runs for real here (hook, adapter row, `backendFetch`, the
// four-attempt retry policy) against a closed synthetic transport.

const ROSTER = /^GET \/api\/app\/chat\/composer\/models\?orgId=org-1$/;

const HAIKU = {
  id: 'anthropic/claude-haiku-4-5',
  label: 'Claude Haiku 4.5',
  providerSlug: 'anthropic',
  providerLabel: 'Anthropic',
  credential: { authMethod: 'api-key' },
};
const MINI = {
  id: 'gpt-5-mini',
  label: 'GPT-5 mini',
  providerSlug: 'openai',
  providerLabel: 'OpenAI',
  credential: { authMethod: 'api-key' },
};

/** A healthy answer: the models the organization's providers serve. */
function roster(models: object[] = [HAIKU, MINI]): Response {
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

/** The Model field as the node inspector holds it for an `llm` step. */
async function renderField({ model = '' }: { model?: string } = {}) {
  const onChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <LlmModelField
        organizationId="org-1"
        model={model}
        required
        readOnly={false}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return { ...view, onChange };
}

/** The field holding what the author types, as the inspector's draft does. */
function EditedField({ initial }: { initial: string }) {
  const [model, setModel] = useState(initial);
  return (
    <LlmModelField
      organizationId="org-1"
      model={model}
      required
      readOnly={false}
      onChange={(next) => setModel(next ?? '')}
    />
  );
}

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'automations', ...options });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const noModels = () =>
  screen.queryByText(i18n.t('agents.modelSearchEmpty', { ns: 'projects' }));

/** The picker's trigger, named by the field's label. */
function picker(): HTMLElement {
  const label = screen.getByText(t('editor.fields.model'), {
    selector: 'label',
  });
  const trigger = document.getElementById(label.getAttribute('for') ?? '');
  if (trigger === null) throw new Error('No Model picker');
  return trigger;
}

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe(
  'LlmModelField when the model roster read fails',
  { timeout: 30_000 },
  () => {
    it('names the failure with Try again, never "No models found", and keeps typing a model', async () => {
      backend.on(ROSTER, () => internalError());
      const { user, onChange } = await renderField();

      // The policy's four attempts, then a settled failure.
      await waitFor(() => expect(backend.count(ROSTER)).toBe(4));
      await waitFor(() => expect(client.isFetching()).toBe(0));

      const alert = await alertSaying(FAILED.en);
      expect(alert).toContainElement(
        screen.getByRole('button', { name: tryAgain() }),
      );
      // Nothing to choose from: the picker stays shut and says no verdict.
      expect(picker()).toBeDisabled();
      await user.click(picker());
      expect(noModels()).not.toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();

      // A model can still be typed while the list is unavailable.
      await user.click(
        screen.getByRole('button', { name: t('editor.llm.typeUnlisted') }),
      );
      await user.type(
        screen.getByRole('textbox', { name: t('editor.llm.modelIdLabel') }),
        'm',
      );
      expect(onChange).toHaveBeenLastCalledWith('m');
      expect(backend.count(ROSTER)).toBe(4);
    });

    it('keeps the model the step names in view, never calling it unserved', async () => {
      backend.on(ROSTER, () => internalError());
      const { user } = await renderField({ model: HAIKU.id });
      await alertSaying(FAILED.en);

      expect(
        screen.getByRole('textbox', { name: t('editor.llm.modelIdLabel') }),
      ).toHaveValue(HAIKU.id);
      expect(
        screen.queryByText(t('editor.llm.modelUnlisted', { model: HAIKU.id })),
      ).not.toBeInTheDocument();

      // Once the roster answers, the picker shows the model by its name.
      backend.on(ROSTER, () => roster());
      await user.click(screen.getByRole('button', { name: tryAgain() }));
      await waitFor(() => expect(picker()).toHaveTextContent(HAIKU.label));
      expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: t('editor.llm.modelIdLabel') }),
      ).not.toBeInTheDocument();
    });

    it('keeps the id box a model was typed into while the read failed when the roster answers later', async () => {
      backend.on(ROSTER, () => internalError());
      const { user } = render(
        <QueryClientProvider client={client}>
          <EditedField initial={HAIKU.id} />
        </QueryClientProvider>,
      );
      await act(async () => {});
      await alertSaying(FAILED.en);
      const box = screen.getByRole('textbox', {
        name: t('editor.llm.modelIdLabel'),
      });
      await user.clear(box);
      await user.type(box, MINI.id);

      // The roster answers while the author is still in the box (a refetch
      // as the tab regains focus): the box stays, with what was typed.
      backend.on(ROSTER, () => roster());
      await act(async () => {
        await client.refetchQueries();
      });
      await waitFor(() => expect(picker()).toHaveTextContent(MINI.label));
      expect(box).toBeInTheDocument();
      expect(box).toHaveValue(MINI.id);
      expect(box).toHaveFocus();
      expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
    });

    it('lists the models when Try again works from the keyboard, and hands the focus to the picker', async () => {
      backend.on(ROSTER, () => internalError());
      const { user, onChange } = await renderField();
      const alert = await alertSaying(FAILED.en);

      backend.on(ROSTER, () => roster());
      const retry = screen.getByRole('button', { name: tryAgain() });
      expect(alert).toContainElement(retry);
      retry.focus();
      await user.keyboard('{Enter}');

      // The Try again that held the focus is gone: the focus is on the
      // picker, not on the page.
      await waitFor(() => expect(picker()).toHaveFocus());
      expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
      expect(picker()).toBeEnabled();
      expect(backend.count(ROSTER)).toBe(5);

      await user.click(picker());
      await user.click(screen.getByRole('option', { name: /GPT-5 mini/ }));
      expect(onChange).toHaveBeenLastCalledWith(MINI.id);
    });

    it('keeps Try again, and the focus on it, while it runs and when it fails again', async () => {
      backend.on(ROSTER, () => internalError());
      const { user } = await renderField();
      const alert = await alertSaying(FAILED.en);
      const retry = screen.getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        ROSTER,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      retry.focus();
      await user.keyboard('{Enter}');

      // react-query resets a read that never answered to `pending` as the
      // retry starts; the notice holds still, its button busy and focused, and
      // nothing masks the field as still loading.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(screen.getByText(FAILED.en).closest('[role="alert"]')).toBe(alert);
      expect(alert.closest('[aria-busy="true"]')).toBeNull();
      expect(picker()).not.toHaveAttribute('aria-hidden');
      expect(noModels()).not.toBeInTheDocument();

      backend.on(ROSTER, () => internalError());
      answer(internalError());
      await waitFor(() => expect(backend.count(ROSTER)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(screen.getByText(FAILED.en).closest('[role="alert"]')).toBe(alert);
      expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
      expect(retry).toHaveFocus();
      expect(picker()).toBeDisabled();
      expect(noModels()).not.toBeInTheDocument();
    });

    it('masks the picker while the first read runs, then offers what it answered', async () => {
      let release = () => {};
      backend.on(
        ROSTER,
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(roster());
          }),
      );
      const { user } = await renderField();
      await waitFor(() => expect(backend.count(ROSTER)).toBe(1));

      await user.click(picker());
      expect(noModels()).not.toBeInTheDocument();
      expect(screen.queryByText(FAILED.en)).not.toBeInTheDocument();
      expect(picker()).toBeDisabled();
      expect(picker()).toHaveAttribute('aria-hidden', 'true');

      await act(async () => release());
      await waitFor(() => expect(picker()).toBeEnabled());
      expect(picker()).not.toHaveAttribute('aria-hidden');
      await user.click(picker());
      expect(
        screen.getByRole('option', { name: /Claude Haiku 4.5/ }),
      ).toBeInTheDocument();
    });

    it('keeps "No models found" for a roster that answered with none', async () => {
      backend.on(ROSTER, () => roster([]));
      const { user } = await renderField();
      await waitFor(() => expect(picker()).toBeEnabled());

      await user.click(picker());
      expect(noModels()).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(backend.count(ROSTER)).toBe(1);
    });

    it.each(SHIPPED_LOCALES)(
      'names the failure in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(ROSTER, () => internalError());
        const { container } = await renderField({ model: HAIKU.id });

        const alert = await alertSaying(FAILED[locale]);
        expect(alert).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);
      },
    );
  },
);

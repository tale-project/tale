import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { RunForTest } from '@/lib/automations/tests/test-from-run';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { SaveAsTestDialog } from './save-as-test-dialog';
import { TestSetupForm, type TestSetupFormProps } from './test-setup-form';

import '@/app/globals.css';

const SAVED = {
  name: 'Synthetic fixture',
  input: { items: [] },
  mocks: { kept: { count: 1 } },
};
const OUTPUT = { customer: 'Synthetic Ada', email: 'ada@example.invalid' };
const DOC: TestSetupFormProps['doc'] = {
  name: 'copy-boundary',
  nodes: [
    { id: 'fetch_rates', type: 'http.get' },
    { id: 'kept', type: 'http.get' },
  ],
};
const RUN: RunForTest = {
  mode: 'live',
  status: 'success',
  input: { customer: 'Synthetic Ada' },
  output: OUTPUT,
  trace: [],
  effects: [],
  startedAt: Date.UTC(2026, 9, 11, 15, 2),
};

let previousLocale: string | null;

beforeEach(() => {
  previousLocale = localStorage.getItem('user-locale');
  localStorage.setItem('user-locale', 'en');
});

afterEach(async () => {
  cleanup();
  if (previousLocale === null) localStorage.removeItem('user-locale');
  else localStorage.setItem('user-locale', previousLocale);
  await i18n.changeLanguage('en');
});

function Setup({
  forEach,
  onChange,
}: {
  forEach: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const [test, setTest] = useState<Record<string, unknown>>(SAVED);
  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1>Test setup</h1>
      <TestSetupForm
        index={0}
        test={test}
        settledTest={test}
        doc={{
          ...DOC,
          nodes: DOC.nodes.map((node) =>
            forEach && node.id === 'fetch_rates'
              ? Object.assign({}, node, { forEach: '{{ input.items }}' })
              : node,
          ),
        }}
        issues={[]}
        diagnosticsStatus="ready"
        readOnly={false}
        onChange={(next) => {
          onChange(next);
          setTest(next);
        }}
        lastRunOutputOf={(node) =>
          node === 'fetch_rates' ? (forEach ? [OUTPUT] : OUTPUT) : undefined
        }
        effectLabel={(connector) => connector}
      />
    </main>
  );
}

function expectInsideViewport(element: HTMLElement, width: number) {
  const box = element.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(200);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(width);
}

describe.each([390, 1280])(
  'authored test copies at %ipx in Chromium',
  (width) => {
    it.each([false, true])(
      'requires a keyboard copy action after an empty mock (forEach=%s)',
      async (forEach) => {
        await page.viewport(width, 844);
        const onChange = vi.fn<(next: Record<string, unknown>) => void>();
        render(<Setup forEach={forEach} onChange={onChange} />);
        const notice = await screen.findByText(
          /The copies can remain after the source run is deleted or removed through retention or erasure/,
        );
        expectInsideViewport(notice, width);
        expect(onChange).not.toHaveBeenCalled();
        screen
          .getByRole('combobox', { name: "Simulate a node's output" })
          .focus();
        await userEvent.keyboard('{Enter}');
        await screen.findByRole('option', { name: 'Fetch rates' });
        await userEvent.keyboard('{Enter}');
        await waitFor(() =>
          expect(onChange).toHaveBeenLastCalledWith({
            ...SAVED,
            mocks: { ...SAVED.mocks, fetch_rates: forEach ? [] : {} },
          }),
        );
        const copy = await screen.findByRole('button', {
          name: "Use the last run's output",
        });
        copy.focus();
        expect(copy).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() =>
          expect(onChange).toHaveBeenLastCalledWith({
            ...SAVED,
            mocks: { ...SAVED.mocks, fetch_rates: forEach ? [OUTPUT] : OUTPUT },
          }),
        );
        expect(SAVED.mocks).toEqual({ kept: { count: 1 } });
      },
    );
  },
);

it.each([
  ['en', 390],
  ['de', 390],
  ['fr', 390],
  ['en', 1280],
] as const)(
  'shows the copy lifetime before confirmation in %s at %ipx',
  async (locale, width) => {
    localStorage.setItem('user-locale', locale);
    await page.viewport(width, 844);
    const onAdd = vi.fn();
    render(
      <SaveAsTestDialog
        run={RUN}
        document={DOC}
        onClose={() => {}}
        onAdd={onAdd}
      />,
    );
    const t = i18n.getFixedT(locale, 'automations');
    const notice = await screen.findByText(t('tests.fromRun.privacy'));
    await waitFor(() => expect(notice).toBeVisible());
    expectInsideViewport(notice, width);
    expect(onAdd).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {
      name: t('tests.fromRun.title'),
    });
    const confirm = within(dialog).getByRole('button', {
      name: t('tests.fromRun.confirm'),
    });
    confirm.focus();
    expect(confirm).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ input: RUN.input }),
    );
  },
);

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen, waitFor } from '@/tests/utils/render';

import { readDocument } from '../lib/document';
import { toIssueView, withIssueIds } from '../lib/issues';
import { AutomationSourceView } from './automation-source-view';

const DOCUMENT = {
  name: 'support/triage',
  nodes: [
    {
      id: 'reply',
      type: 'llm',
      prompt: 'Answer {{ nodes.nope.output }}',
      credential: 'kept-as-written',
    },
  ],
  tests: [{ name: 'smoke', input: {} }],
};

const t = i18n.getFixedT('en', 'automations');

function issues() {
  const view = readDocument(DOCUMENT);
  if (view === null) throw new Error('not a document');
  return withIssueIds([
    {
      level: 'error',
      code: 'REF_UNKNOWN_NODE',
      message: 'nodes.nope does not exist',
      at: { pointer: '/nodes/0/prompt', range: [10, 15] },
      params: { ref: 'nope', suggestion: 'reply' },
    },
    {
      level: 'warning',
      code: 'TEST_X',
      message: 'the test is odd',
      at: { pointer: '/tests/0/name' },
    },
  ]).map((issue) =>
    toIssueView(issue, view, {
      locale: 'en',
      t,
      controlsOf: () => new Set(['prompt']),
    }),
  );
}

function renderView(props: { isDraft?: boolean; showEditHint?: boolean } = {}) {
  return render(
    <AutomationSourceView
      document={DOCUMENT}
      settled={DOCUMENT}
      issues={issues()}
      diagnosticsStatus="ready"
      automationSlug="support/triage"
      version={7}
      isDraft={props.isDraft ?? false}
      viewSwitch={<span>views</span>}
      showEditHint={props.showEditHint ?? true}
    />,
  );
}

const sourceBox = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Source of this automation (YAML)',
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutomationSourceView', () => {
  it('shows the document as read-only YAML, every key kept', () => {
    renderView();
    const box = sourceBox();
    expect(box).toHaveAttribute('aria-readonly', 'true');
    expect(box).toHaveAttribute('data-language', 'yaml');
    expect(box).toHaveAttribute('data-templates', '');
    expect(parse(box.value)).toEqual(DOCUMENT);
  });

  it('marks every problem at the place it names, without a fix to apply', () => {
    renderView();
    const box = sourceBox();
    const marks = JSON.parse(box.dataset.diagnostics ?? '[]') as Array<{
      severity: string;
      range?: [number, number];
      fixes?: string[];
    }>;
    expect(marks).toHaveLength(2);
    const [reference, test] = marks;
    expect(box.value.slice(reference?.range?.[0], reference?.range?.[1])).toBe(
      'nodes',
    );
    expect(reference?.fixes).toBeUndefined();
    expect(test?.severity).toBe('warning');
    expect(box.value.slice(test?.range?.[0], test?.range?.[1])).toBe('smoke');
  });

  it('copies the YAML and says so', async () => {
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Copy YAML' }));
    await expect(navigator.clipboard.readText()).resolves.toBe(
      sourceBox().value,
    );
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Copied');
    });
  });

  it('downloads the YAML named after the automation, its version and a draft', async () => {
    const created = vi.fn((_blob: Blob) => 'blob:source');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        names.push(this.download);
      },
    );
    const { user, unmount } = renderView();
    await user.click(screen.getByRole('button', { name: 'Download YAML' }));
    expect(names).toEqual(['support__triage-v7.yml']);
    const blob = created.mock.calls[0]?.[0];
    expect(await blob?.text()).toBe(sourceBox().value);
    unmount();
    const draft = renderView({ isDraft: true });
    await draft.user.click(
      screen.getByRole('button', { name: 'Download YAML' }),
    );
    expect(names.at(-1)).toBe('support__triage-v7-draft.yml');
  });

  it('tells an author how to change the document, and a reader nothing', () => {
    const { unmount } = renderView();
    expect(
      screen.getByText(
        'To change the document, use the fields or your coding agent.',
      ),
    ).toBeVisible();
    unmount();
    renderView({ showEditHint: false });
    expect(
      screen.queryByText(
        'To change the document, use the fields or your coding agent.',
      ),
    ).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = renderView();
    await checkAccessibility(container);
  });
});

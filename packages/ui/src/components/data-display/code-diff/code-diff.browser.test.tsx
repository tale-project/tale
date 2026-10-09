import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { CodeDiff, type CodeDiffHandle, type CodeDiffProps } from './code-diff';
import { computeLineDiff, toUnifiedPatch } from './compute';
import { CODE_DIFF_BUDGET } from './rows';

import '../../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  vi.restoreAllMocks();
});

const BEFORE = [
  'name: Triage issues',
  'description: Sort new issues',
  'inputs:',
  '  type: object',
  '  properties:',
  '    owner:',
  '      type: string',
  '    repo:',
  '      type: string',
  'nodes:',
  '  - id: issues',
  '    type: github.list_issues',
  '    input:',
  '      owner: "{{ input.owner }}"',
  '      repo: "{{ input.repo }}"',
  '  - id: score',
  '    type: llm',
  '    model: claude-haiku-4-5',
  '    prompt: |',
  '      Score each issue from 1 to 5.',
  '      Say why in one sentence.',
  '  - id: report',
  '    type: transform',
  '    code: return nodes.score',
  'output: "{{ nodes.report }}"',
  '',
].join('\n');

const AFTER = BEFORE.replace(
  'description: Sort new issues',
  'description: Sort and label new issues',
)
  .replace('model: claude-haiku-4-5', 'model: claude-sonnet-4-5')
  .replace(
    '      Say why in one sentence.\n',
    '      Say why in one sentence.\n      Keep it short.\n',
  );

const DIFF = computeLineDiff(BEFORE, AFTER);

function Diff(props: Partial<CodeDiffProps> & { width?: number }) {
  const { width = 900, ...rest } = props;
  return (
    <div data-testid="frame" style={{ width }}>
      <button type="button">Before the diff</button>
      <CodeDiff
        before={BEFORE}
        after={AFTER}
        language="yaml"
        templates
        beforeLabel="v4"
        afterLabel="v5"
        aria-label="Changes from v4 to v5"
        {...rest}
      />
    </div>
  );
}

/** Renders a diff and resolves once its rows are on the page. */
async function renderDiff(
  props: Partial<CodeDiffProps> & { width?: number } = {},
) {
  await page.viewport(1400, 1000);
  const view = render(<Diff {...props} />);
  await screen.findByRole('table', {}, { timeout: 10_000 });
  return view;
}

const announcer = () =>
  document.querySelector('[data-slot="code-diff-announcer"]')?.textContent;

/** The header the reader lands on for hunk `index`. */
function hunkHeader(index: number): string {
  const hunk = DIFF.hunks[index];
  if (hunk === undefined) throw new Error(`no hunk ${index}`);
  const from = hunk.after.start;
  const to = hunk.after.start + hunk.after.count - 1;
  return `Lines ${from}–${to} in v5`;
}

describe('CodeDiff', () => {
  it('signs each changed line, marks its changed words and names both for a screen reader', async () => {
    const { container } = await renderDiff();
    const added = container.querySelectorAll('tr[data-diff-line="added"]');
    const removed = container.querySelectorAll('tr[data-diff-line="removed"]');
    expect(added).toHaveLength(3);
    expect(removed).toHaveLength(2);
    // The sign is a glyph; its words are for a screen reader.
    const sign = added[0]?.querySelectorAll('td')[2];
    expect(sign?.querySelector('[aria-hidden="true"]')?.textContent).toBe('+');
    expect(sign?.querySelector('.sr-only')?.textContent).toBe('Added');
    expect(
      removed[0]?.querySelectorAll('td')[2]?.querySelector('.sr-only')
        ?.textContent,
    ).toBe('Removed');
    // The words that changed, and only those, carry the word tint.
    expect(
      [...container.querySelectorAll('ins')].map((ins) => ins.textContent),
    ).toEqual(['and label ', 'sonnet']);
    expect(
      [...container.querySelectorAll('del')].map((del) => del.textContent),
    ).toEqual(['haiku']);
    const ins = container.querySelector('ins');
    expect(getComputedStyle(ins as Element).textDecorationLine).toBe('none');
    // A whole new line marks no words: its tint says it.
    const keepShort = [...added].find((row) =>
      row.textContent?.includes('Keep it short'),
    );
    expect(keepShort?.querySelector('ins')).toBeNull();
    // Column names for a screen reader, the caption from the label.
    const table = screen.getByRole('table', { name: 'Changes from v4 to v5' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Line in v4', 'Line in v5', 'Change', 'Text']);
  });

  it('highlights each whole text in the code palette', async () => {
    const { container } = await renderDiff();
    await waitFor(
      () => {
        const coloured = container.querySelectorAll<HTMLElement>(
          'tr[data-diff-line] td span[style*="--code-token"]',
        );
        expect(coloured.length).toBeGreaterThan(10);
      },
      { timeout: 10_000 },
    );
    // A line inside a block scalar is a string, as in its whole document.
    const say = [
      ...container.querySelectorAll<HTMLElement>('tr[data-diff-line] span'),
    ].find((span) => span.textContent?.includes('Keep it short'));
    expect(say?.getAttribute('style')).toContain('--code-token-string');
  });

  it('folds the unchanged runs and opens them in place', async () => {
    const { container } = await renderDiff();
    const between = screen.getByRole('button', {
      name: 'Show 9 unchanged lines',
    });
    expect(between).toHaveAttribute('aria-expanded', 'false');
    const lines = () =>
      container.querySelectorAll('tr[data-diff-line="unchanged"]').length;
    const shown = lines();
    await userEvent.click(between);
    const opened = screen.getByRole('button', {
      name: 'Hide 9 unchanged lines',
    });
    expect(opened).toHaveAttribute('aria-expanded', 'true');
    expect(opened).toHaveFocus();
    expect(lines()).toBe(shown + 9);
    await userEvent.click(opened);
    expect(lines()).toBe(shown);
  });

  it('steps from change to change with the buttons and [ ], focusing each and saying where', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await renderDiff();
    expect(
      document.querySelector('[data-slot="code-diff-position"]'),
    ).toHaveTextContent('2 changes');
    await userEvent.click(screen.getByRole('button', { name: 'Next change' }));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-diff-hunk', '0'),
    );
    expect(document.activeElement?.textContent).toBe(hunkHeader(0));
    expect(announcer()).toBe('Change 1 of 2');
    expect(scroll).toHaveBeenLastCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
    await userEvent.keyboard(']');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-diff-hunk', '1'),
    );
    expect(document.activeElement?.textContent).toBe(hunkHeader(1));
    expect(announcer()).toBe('Change 2 of 2');
    expect(
      document.querySelector('[data-slot="code-diff-position"]'),
    ).toHaveTextContent('Change 2 of 2');
    // Past the last change it stays there.
    await userEvent.keyboard(']');
    expect(document.activeElement).toHaveAttribute('data-diff-hunk', '1');
    await userEvent.keyboard('[[');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-diff-hunk', '0'),
    );
    expect(announcer()).toBe('Change 1 of 2');
  });

  it('answers a host through its handle', async () => {
    const ref = createRef<CodeDiffHandle>();
    await renderDiff({ ref } as Partial<CodeDiffProps>);
    ref.current?.focusChange(1);
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-diff-hunk', '1'),
    );
    ref.current?.previousChange();
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-diff-hunk', '0'),
    );
  });

  it('sets the texts side by side from 64rem, and in one column below', async () => {
    const { container } = await renderDiff({ width: 1100 });
    const table = () => container.querySelector('table');
    expect(table()).toHaveAttribute('data-layout', 'unified');
    // The switch shows once the diff has measured its room.
    await userEvent.click(
      await screen.findByRole('radio', { name: 'Side by side' }),
    );
    expect(table()).toHaveAttribute('data-layout', 'split');
    const pair = [...container.querySelectorAll('tr[data-diff-pair]')].find(
      (row) => row.textContent?.includes('haiku'),
    );
    expect(pair?.textContent).toContain('sonnet');
    expect(
      within(table() as HTMLElement)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Line in v4', 'Change', 'Text', 'Line in v5', 'Change', 'Text']);
    // A line only one side has faces an empty, hatched cell.
    const keepShort = [
      ...container.querySelectorAll('tr[data-diff-pair]'),
    ].find((row) => row.textContent?.includes('Keep it short'));
    expect(keepShort?.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(
      3,
    );
    // Too narrow for two columns: one column, and no switch to offer.
    const frame = screen.getByTestId('frame');
    frame.style.width = '900px';
    await waitFor(() =>
      expect(table()).toHaveAttribute('data-layout', 'unified'),
    );
    expect(screen.queryByRole('radio', { name: 'Side by side' })).toBeNull();
  });

  it('shows one column for a host that asks for side by side in a narrow frame', async () => {
    const { container } = await renderDiff({ layout: 'split', width: 700 });
    expect(container.querySelector('table')).toHaveAttribute(
      'data-layout',
      'unified',
    );
  });

  it('copies the patch the engine writes, and says so', async () => {
    const write = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    await renderDiff();
    await userEvent.click(screen.getByRole('button', { name: 'Copy patch' }));
    expect(write).toHaveBeenCalledWith(
      toUnifiedPatch(BEFORE, AFTER, { from: 'v4', to: 'v5' }).patch,
    );
    await waitFor(() => expect(announcer()).toBe('Copied'));
  });

  it('says there are no differences between equal texts', async () => {
    await page.viewport(1400, 1000);
    render(<Diff after={BEFORE} />);
    expect(await screen.findByText('No differences')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();
    render(<Diff after={BEFORE} emptyMessage="Only the message differs." />);
    expect(await screen.findByText('Only the message differs.')).toBeVisible();
  });

  it('draws the first changed lines of a very large diff and the rest on request', async () => {
    const half = CODE_DIFF_BUDGET.above / 2 + 100;
    const big = (word: string) =>
      Array.from({ length: half }, (_, at) => `${word} ${at}\n`).join('');
    const { container } = await renderDiff({
      before: big('old'),
      after: big('new'),
      language: 'text',
      templates: false,
    });
    const changed = () =>
      container.querySelectorAll(
        'tr[data-diff-line="added"], tr[data-diff-line="removed"]',
      ).length;
    expect(changed()).toBe(CODE_DIFF_BUDGET.shown);
    const rest = half * 2 - CODE_DIFF_BUDGET.shown;
    await userEvent.click(
      screen.getByRole('button', {
        name: `Show the remaining ${rest.toLocaleString('en')} changes`,
      }),
    );
    await waitFor(() => expect(changed()).toBe(half * 2), { timeout: 20_000 });
  }, 60_000);

  it.each(['light', 'dark'])(
    'passes axe and keeps every word readable on the tints (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = await renderDiff();
      await waitFor(
        () =>
          expect(
            container.querySelectorAll('span[style*="--code-token"]').length,
          ).toBeGreaterThan(10),
        { timeout: 10_000 },
      );
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
      for (const element of container.querySelectorAll<HTMLElement>(
        'tr[data-diff-line="added"] td span, tr[data-diff-line="added"] ins, tr[data-diff-line="removed"] td span, tr[data-diff-line="removed"] del',
      )) {
        if (element.classList.contains('sr-only')) continue;
        if (element.textContent?.trim() === '') continue;
        expect(
          ratioAgainst(element, getComputedStyle(element).color),
          `${theme} "${element.textContent}"`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('fades opened lines in, and moves at once under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = await renderDiff();
    await userEvent.click(
      screen.getByRole('button', { name: 'Show 9 unchanged lines' }),
    );
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number(animation.effect?.getComputedTiming().duration) > 1,
      );
    expect(running).toEqual([]);
    expect(
      container.querySelector('tr[data-diff-line].animate-in'),
    ).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Next change' }));
    await waitFor(() =>
      expect(scroll).toHaveBeenLastCalledWith({
        block: 'center',
        behavior: 'auto',
      }),
    );
  });

  it('drops the tints in forced colours and marks a changed line with an edge', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    const { container } = await renderDiff();
    const row = container.querySelector('tr[data-diff-line="added"]');
    const sign = row?.querySelectorAll('td')[2];
    expect(getComputedStyle(sign as Element).borderInlineStartWidth).toBe(
      '2px',
    );
    const word = container.querySelector('ins');
    expect(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--diff-added-emphasis',
      ),
    ).toBe('transparent');
    expect(word).not.toBeNull();
  });
});

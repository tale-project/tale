// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type DiffDocumentsOptions,
  diffAutomationDocuments,
} from '@/lib/engine/core/diff/automation';
import type { Automation } from '@/lib/engine/core/types';
import { i18n } from '@/lib/i18n/i18n';
import {
  type ShippedLocale,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, within } from '@/tests/utils/render';

import { nodeCatalogView } from '../../lib/node-face';
import {
  graphBoxOf,
  itemsOfBox,
  useVersionChangeSections,
  VersionChanges,
} from './version-changes';

const BEFORE = {
  version: 1,
  name: 'digest',
  nodes: [
    { id: 'collect', type: 'transform', code: "return 'collect';" },
    { id: 'post', type: 'transform', code: "return 'post';" },
  ],
  output: '{{ nodes.post.output }}',
  tests: [{ name: 'says hello', input: {}, expect: { output: 'hello' } }],
} as unknown as Automation;

const AFTER = {
  version: 1,
  name: 'digest',
  inputs: {
    type: 'object',
    properties: { week: { type: 'string' } },
    required: ['week'],
  },
  nodes: [
    { id: 'collect', type: 'transform', code: 'return input.week;' },
    { id: 'publish', type: 'transform', code: "return 'post';" },
  ],
  output: '{{ nodes.publish.output }}',
  tests: [
    { name: 'says hello', input: { week: 'W41' }, expect: { output: 'hello' } },
  ],
} as unknown as Automation;

const LABELS = { before: 'v6', after: 'v7' };
const CATALOG = nodeCatalogView([]);

function Changes({
  onShowOnGraph,
  before = BEFORE,
  after = AFTER,
  options,
}: {
  onShowOnGraph?: (id: string) => void;
  before?: Automation;
  after?: Automation;
  options?: DiffDocumentsOptions;
}) {
  const sections = useVersionChangeSections({
    diff: diffAutomationDocuments(before, after, options),
    before,
    after,
    labels: LABELS,
    catalog: CATALOG,
  });
  return (
    <VersionChanges
      sections={sections}
      {...(onShowOnGraph !== undefined && { onShowOnGraph })}
    />
  );
}

describe('the changes of a comparison', () => {
  it('groups what changed by where it is, each with its badge and words', () => {
    render(<Changes />);
    const start = screen.getByRole('region', { name: /^Start: run inputs/ });
    expect(within(start).getByText('week')).toBeVisible();
    expect(within(start).getByText('Now required')).toBeVisible();
    const nodes = screen.getByRole('region', { name: /^Nodes/ });
    expect(within(nodes).getByText('Collect')).toBeVisible();
    expect(within(nodes).getByText('Code changed')).toBeVisible();
    expect(within(nodes).getByText('Publish')).toBeVisible();
    expect(within(nodes).getByText('Was Post')).toBeVisible();
    expect(
      screen.getByRole('region', { name: /^End: output/ }),
    ).toHaveTextContent('Output');
    const tests = screen.getByRole('region', { name: /^Tests/ });
    expect(within(tests).getByText('says hello')).toBeVisible();
    expect(within(tests).getByText('Input changed')).toBeVisible();
    expect(
      screen.getByText(
        'Triggers and projects belong to the automation, not to a version.',
      ),
    ).toBeVisible();
  });

  it('shows a node, an input or the output on the graph, but never a test', async () => {
    const onShowOnGraph = vi.fn();
    const { user } = render(<Changes onShowOnGraph={onShowOnGraph} />);
    const nodes = screen.getByRole('region', { name: /^Nodes/ });
    await user.click(within(nodes).getByRole('button', { name: /Collect/ }));
    await user.click(
      within(nodes).getByRole('button', { name: 'Show on the graph' }),
    );
    expect(onShowOnGraph).toHaveBeenLastCalledWith('collect');
    const start = screen.getByRole('region', { name: /^Start: run inputs/ });
    await user.click(within(start).getByRole('button', { name: /week/ }));
    await user.click(
      within(start).getAllByRole('button', { name: 'Show on the graph' })[0]!,
    );
    expect(onShowOnGraph).toHaveBeenLastCalledWith('__start');
    await user.click(screen.getByRole('button', { name: /says hello/ }));
    expect(
      within(screen.getByRole('region', { name: /^Tests/ })).queryByRole(
        'button',
        { name: 'Show on the graph' },
      ),
    ).toBeNull();
  });
});

/** One test whose simulated output and expected output change. */
const GREETS_BEFORE = {
  version: 1,
  name: 'digest',
  nodes: [{ id: 'collect', type: 'transform', code: "return 'hi';" }],
  output: '{{ nodes.collect.output }}',
  tests: [
    {
      name: 'greets',
      input: {},
      mocks: { collect: 'hi' },
      expect: { output: 'hi' },
    },
  ],
} as unknown as Automation;

const GREETS_AFTER = {
  ...GREETS_BEFORE,
  tests: [
    {
      name: 'greets',
      input: {},
      mocks: { collect: 'hello' },
      expect: { output: 'hello' },
    },
  ],
} as unknown as Automation;

/** The label of each field row in `region`, in order. */
function rowLabels(region: HTMLElement): (string | null)[] {
  return Array.from(
    region.querySelectorAll('[data-slot="field-change-row"]'),
    (row) => row.firstElementChild?.textContent ?? null,
  );
}

/** The accessible names given in `region` that read like a test's key. */
function keyLikeNames(region: HTMLElement): string[] {
  return Array.from(
    region.querySelectorAll('[aria-label]'),
    (named) => named.getAttribute('aria-label') ?? '',
  ).filter((name) => /mocks|expect\.|outputIncludes/.test(name));
}

describe('the fields of a changed test', () => {
  afterEach(async () => {
    await forgetSavedLocale();
  });

  it.each<[ShippedLocale, string, string, string]>([
    [
      'en',
      'Simulated outputs and Output changed',
      'Simulated outputs',
      'Output',
    ],
    [
      'de',
      'Simulierte Ausgaben und Ausgabe geändert',
      'Simulierte Ausgaben',
      'Ausgabe',
    ],
    ['fr', 'Sorties simulées et Sortie modifiés', 'Sorties simulées', 'Sortie'],
  ])(
    'are named in %s the way the test form names them, never by key',
    async (locale, summary, mocks, output) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      render(<Changes before={GREETS_BEFORE} after={GREETS_AFTER} />);

      const tests = screen.getByRole('region', { name: /^Tests/ });
      expect(within(tests).getByText(summary)).toBeVisible();
      // The comparison's only change opens at once.
      expect(rowLabels(tests)).toEqual([mocks, output]);
      expect(within(tests).getByRole('group', { name: mocks })).toBeVisible();
      expect(within(tests).getByRole('group', { name: output })).toBeVisible();
      expect(tests).not.toHaveTextContent(/mocks|expect\./);
      expect(keyLikeNames(tests)).toEqual([]);
    },
  );

  it('names every other part the way the test form does, and an expectation it has no words for as one of the Expectations', () => {
    const checks = (round: 1 | 2) => ({
      name: 'checks',
      description: round === 1 ? 'Greets' : 'Greets the week',
      input: {},
      failures: { collect: round === 1 ? 'down' : 'timed out' },
      expect: {
        outputIncludes: { text: round === 1 ? 'hi' : 'hello' },
        effects: round === 1 ? [] : [{ connector: 'slack' }],
        nodes: { collect: round === 1 ? 'ran' : 'skipped' },
        failure: round === 1 ? { node: 'collect' } : { message: 'down' },
        later: round,
      },
    });
    render(
      <Changes
        before={
          { ...GREETS_BEFORE, tests: [checks(1)] } as unknown as Automation
        }
        after={
          { ...GREETS_BEFORE, tests: [checks(2)] } as unknown as Automation
        }
      />,
    );

    const tests = screen.getByRole('region', { name: /^Tests/ });
    expect(rowLabels(tests)).toEqual([
      'Description',
      'Simulated failures',
      'Output',
      'Actions',
      'Nodes',
      'The run must fail',
      'Expectations',
    ]);
    expect(tests).not.toHaveTextContent(/expect\.|outputIncludes/);
    expect(keyLikeNames(tests)).toEqual([]);
  });

  it("names the automation's description and its package data by their rows' titles", async () => {
    const { user } = render(
      <Changes
        before={
          { ...GREETS_BEFORE, description: 'Greets' } as unknown as Automation
        }
        after={
          {
            ...GREETS_BEFORE,
            description: 'Greets the week',
          } as unknown as Automation
        }
        options={{
          beforePackage: { settings: { retries: 1 } },
          afterPackage: { settings: { retries: 2 } },
        }}
      />,
    );

    // The comparison's first change opens at once.
    expect(
      rowLabels(screen.getByRole('region', { name: /^End: output/ })),
    ).toEqual(['Description']);
    const packageData = screen.getByRole('region', { name: /^Package data/ });
    await user.click(
      within(packageData).getByRole('button', { name: /Settings/ }),
    );
    expect(rowLabels(packageData)).toEqual(['Settings']);
    expect(
      within(packageData).getByRole('group', { name: 'Settings' }),
    ).toBeVisible();
  });
});

describe('graph boxes and the list', () => {
  it('maps each item to the box it is shown on', () => {
    expect(graphBoxOf('node:collect')).toBe('collect');
    expect(graphBoxOf('input:week')).toBe('__start');
    expect(graphBoxOf('end:output')).toBe('__end');
    expect(graphBoxOf('test:says hello')).toBeNull();
    expect(graphBoxOf('package:settings')).toBeNull();
    const sections = [
      {
        id: 'start',
        title: 'Start',
        items: [
          { id: 'input:week', kind: 'added' as const, title: 'week' },
          { id: 'input:', kind: 'added' as const, title: 'schema' },
        ],
      },
      {
        id: 'nodes',
        title: 'Nodes',
        items: [{ id: 'node:a', kind: 'changed' as const, title: 'A' }],
      },
    ];
    expect(itemsOfBox(sections, '__start').map((item) => item.id)).toEqual([
      'input:week',
      'input:',
    ]);
    expect(itemsOfBox(sections, 'a').map((item) => item.id)).toEqual([
      'node:a',
    ]);
    expect(itemsOfBox(sections, 'b')).toEqual([]);
  });
});

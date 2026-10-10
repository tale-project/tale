import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import {
  SchemaTree,
  schemaKindLabel,
  type SchemaTreeSchema,
} from './schema-tree';

let i18n: ReturnType<typeof initServiceI18n>;
beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

function tFor(locale: string): TFunction {
  return i18n.getFixedT(locale, 'schemaTree');
}

const ISSUES: SchemaTreeSchema = {
  type: 'object',
  required: ['owner', 'repo'],
  properties: {
    owner: {
      type: 'string',
      description: 'The account that owns the repository.',
    },
    repo: { type: 'string' },
    limit: { type: 'integer' },
    state: { enum: ['open', 'closed'] },
    labels: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          score: { type: ['number', 'null'] },
        },
      },
    },
  },
};

describe('schemaKindLabel', () => {
  it.each([
    ['en', { type: 'string' }, 'text'],
    ['en', { type: 'integer' }, 'a whole number'],
    ['en', { type: 'array', items: { type: 'object' } }, 'list of objects'],
    ['en', { type: 'array', items: { type: 'array' } }, 'list of lists'],
    ['en', { type: 'array' }, 'list of values'],
    ['en', { type: ['string', 'null'] }, 'text or empty'],
    [
      'en',
      { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
      'a number or true or false',
    ],
    ['en', { properties: { a: {} } }, 'an object'],
    ['en', {}, 'anything'],
    ['de', { type: 'array', items: { type: 'string' } }, 'Liste von Texten'],
    ['de', { type: 'boolean' }, 'wahr oder falsch'],
    // French carries the preposition in the plural, so "objets" elides.
    ['fr', { type: 'array', items: { type: 'object' } }, "liste d'objets"],
    ['fr', { type: 'array', items: { type: 'number' } }, 'liste de nombres'],
  ] as const)('%s: %j reads "%s"', (locale, schema, expected) => {
    expect(schemaKindLabel(tFor(locale), schema, locale)).toBe(expected);
  });

  it('quotes the values of an enum the way each language does', () => {
    const schema = { enum: ['draft', 'sent'] };
    expect(schemaKindLabel(tFor('en'), schema, 'en')).toBe(
      'one of “draft” or “sent”',
    );
    expect(schemaKindLabel(tFor('de'), schema, 'de')).toBe(
      'eines von „draft“ oder „sent“',
    );
    expect(schemaKindLabel(tFor('fr'), schema, 'fr')).toBe(
      "l'un de «\u00a0draft\u00a0» ou «\u00a0sent\u00a0»",
    );
    expect(schemaKindLabel(tFor('de'), schema, 'de-CH')).toBe(
      'eines von «draft» oder «sent»',
    );
  });
});

describe('SchemaTree', () => {
  it('lists the top-level fields with their kind, compactly', () => {
    render(<SchemaTree schema={ISSUES} density="compact" />);
    const list = screen.getByRole('list', { name: 'Fields' });
    const rows = [...list.querySelectorAll(':scope > li')].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      'owner text · required',
      'repo text · required',
      'limit a whole number',
      'state one of “open” or “closed”',
      'labels list of texts',
      'issues list of objects',
    ]);
    expect(
      screen.queryByText('The account that owns the repository.'),
    ).toBeNull();
  });

  it('stops at maxRows and says how many fields are left', () => {
    render(<SchemaTree schema={ISSUES} density="compact" maxRows={2} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('4 more fields')).toBeInTheDocument();
  });

  it('nests the fields of objects and of list items, with descriptions', () => {
    render(<SchemaTree schema={ISSUES} />);
    expect(
      screen.getByText('The account that owns the repository.'),
    ).toBeInTheDocument();
    const issues = screen.getByText('issues').closest('li') as HTMLElement;
    const nested = [...issues.querySelectorAll('ul > li')].map(
      (row) => row.textContent,
    );
    expect(nested).toEqual([
      'title text · required',
      'score a number or empty · optional',
    ]);
    // Optional only says so where the object names what is required.
    expect(screen.getByText('limit').nextElementSibling?.textContent).toBe(
      'a whole number · optional',
    );
  });

  it('tags fields and says which may be empty', () => {
    render(
      <SchemaTree
        schema={ISSUES}
        density="compact"
        tagOf={(path) => (path[0] === 'owner' ? 'from the trigger' : undefined)}
        maybeEmpty={(path) => path[0] === 'limit'}
      />,
    );
    expect(screen.getByText('owner').nextElementSibling?.textContent).toBe(
      'text · required · from the trigger',
    );
    expect(screen.getByText('limit').nextElementSibling?.textContent).toBe(
      'a whole number · may be empty',
    );
  });

  it('says the kind of a value that has no fields', () => {
    render(
      <SchemaTree schema={{ type: 'array', items: { type: 'number' } }} />,
    );
    expect(screen.getByText('list of numbers')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers the shape as TypeScript behind a disclosure', () => {
    render(<SchemaTree schema={ISSUES} typeScript="{ owner: string }" />);
    expect(screen.getByText('Show as TypeScript')).toBeInTheDocument();
  });

  it('passes axe audit', async () => {
    const { container } = render(
      <SchemaTree schema={ISSUES} typeScript="{ owner: string }" />,
    );
    await checkAccessibility(container);
  });
});

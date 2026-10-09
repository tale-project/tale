'use client';

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { HighlightedCode } from '../../markdown/highlighted-code';
import { CollapsibleDetails } from '../navigation/collapsible-details';

/**
 * The fields a value has, as a reader reads a form: each field's name, what
 * kind of value it holds in words ("text", "a number", "list of objects"),
 * whether it is required, and where it comes from. For the input a run
 * starts with, what a step receives and returns, a webhook's payload.
 */

/** A JSON Schema subset: what describes the fields of a value. */
export interface SchemaTreeSchema {
  type?:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | ReadonlyArray<string>;
  properties?: Readonly<Record<string, SchemaTreeSchema>>;
  required?: readonly string[];
  items?: SchemaTreeSchema;
  enum?: readonly unknown[];
  anyOf?: readonly SchemaTreeSchema[];
  /** Written by the author; shown as is (document content, not translated). */
  description?: string;
}

export interface SchemaTreeProps {
  schema: SchemaTreeSchema;
  /**
   * `compact`: the top-level fields, one line each (a node's face, a
   * summary). `comfortable`: nested fields and descriptions too.
   */
  density?: 'compact' | 'comfortable';
  /** Top-level fields shown before "+n more fields". */
  maxRows?: number;
  /** A tag after the kind: "from the trigger", "from Triage". */
  tagOf?: (path: readonly string[]) => string | undefined;
  /** Adds "may be empty" to a field. */
  maybeEmpty?: (path: readonly string[]) => boolean;
  /** The same shape as TypeScript, behind "Show as TypeScript". */
  typeScript?: string;
  'aria-label'?: string;
  className?: string;
}

type PluralKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any';

function typesOf(schema: SchemaTreeSchema): string[] {
  if (schema.type === undefined) return [];
  return typeof schema.type === 'string' ? [schema.type] : [...schema.type];
}

function singular(t: TFunction, kind: string): string {
  switch (kind) {
    case 'string':
      return t('kinds.string');
    case 'number':
      return t('kinds.number');
    case 'integer':
      return t('kinds.integer');
    case 'boolean':
      return t('kinds.boolean');
    case 'object':
      return t('kinds.object');
    case 'null':
      return t('kinds.null');
    default:
      return t('kinds.any');
  }
}

function plural(t: TFunction, kind: PluralKind): string {
  switch (kind) {
    case 'string':
      return t('kindsPlural.string');
    case 'number':
      return t('kindsPlural.number');
    case 'integer':
      return t('kindsPlural.integer');
    case 'boolean':
      return t('kindsPlural.boolean');
    case 'object':
      return t('kindsPlural.object');
    case 'array':
      return t('kindsPlural.array');
    default:
      return t('kindsPlural.any');
  }
}

/** The kind a list's items have, in the plural ("texts", "objects"). */
function itemsKind(schema: SchemaTreeSchema | undefined): PluralKind {
  const [first] = schema === undefined ? [] : typesOf(schema);
  if (
    first === 'string' ||
    first === 'number' ||
    first === 'integer' ||
    first === 'boolean' ||
    first === 'object' ||
    first === 'array'
  ) {
    return first;
  }
  if (schema?.properties !== undefined) return 'object';
  return 'any';
}

/** Quotation marks of the reader's language around a literal value. */
function quoted(locale: string, value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (locale.startsWith('de-CH')) return `«${text}»`;
  if (locale.startsWith('de')) return `„${text}“`;
  if (locale.startsWith('fr')) return `« ${text} »`;
  return `“${text}”`;
}

function either(locale: string, parts: string[]): string {
  return new Intl.ListFormat(locale, {
    style: 'long',
    type: 'disjunction',
  }).format(parts);
}

/**
 * A schema's kind in words: "text", "a number", "list of objects",
 * "one of “draft” or “sent”", "text or empty".
 */
export function schemaKindLabel(
  t: TFunction,
  schema: SchemaTreeSchema,
  locale = 'en',
): string {
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return t('oneOf', {
      values: either(
        locale,
        schema.enum.map((value) => quoted(locale, value)),
      ),
    });
  }
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    return either(
      locale,
      schema.anyOf.map((option) => schemaKindLabel(t, option, locale)),
    );
  }
  const types = typesOf(schema);
  if (types.length === 0) {
    return schema.properties !== undefined ? t('kinds.object') : t('kinds.any');
  }
  return either(
    locale,
    types.map((type) =>
      type === 'array'
        ? t('kinds.array', { item: plural(t, itemsKind(schema.items)) })
        : singular(t, type),
    ),
  );
}

/** The fields to list under a schema: its own, or those of its items. */
function fieldsOf(schema: SchemaTreeSchema): {
  properties: Readonly<Record<string, SchemaTreeSchema>>;
  required: readonly string[];
} | null {
  if (schema.properties !== undefined) {
    return { properties: schema.properties, required: schema.required ?? [] };
  }
  if (schema.items?.properties !== undefined) {
    return {
      properties: schema.items.properties,
      required: schema.items.required ?? [],
    };
  }
  return null;
}

interface RowsProps {
  schema: SchemaTreeSchema;
  path: readonly string[];
  density: 'compact' | 'comfortable';
  maxRows: number | undefined;
  tagOf: SchemaTreeProps['tagOf'];
  maybeEmpty: SchemaTreeProps['maybeEmpty'];
  t: TFunction;
  locale: string;
  label?: string;
  nested?: boolean;
}

function Rows({
  schema,
  path,
  density,
  maxRows,
  tagOf,
  maybeEmpty,
  t,
  locale,
  label,
  nested = false,
}: RowsProps) {
  const fields = fieldsOf(schema);
  if (fields === null) return null;
  const names = Object.keys(fields.properties);
  const shown = maxRows === undefined ? names : names.slice(0, maxRows);
  const hidden = names.length - shown.length;
  const comfortable = density === 'comfortable';
  return (
    <ul
      aria-label={label}
      className={cn(
        'flex flex-col',
        nested && 'border-border mt-1 ml-1 border-l pl-4',
      )}
    >
      {shown.map((name) => {
        const field = fields.properties[name] ?? {};
        const fieldPath = [...path, name];
        const isRequired = fields.required.includes(name);
        const tag = tagOf?.(fieldPath);
        const empty = maybeEmpty?.(fieldPath) ?? false;
        const notes = [
          schemaKindLabel(t, field, locale),
          ...(isRequired
            ? [t('required')]
            : comfortable && fields.required.length > 0
              ? [t('optional')]
              : []),
          ...(tag !== undefined ? [tag] : []),
          ...(empty ? [t('maybeEmpty')] : []),
        ];
        return (
          <li
            key={name}
            className={cn(
              'flex flex-col justify-center',
              comfortable ? 'min-h-8 py-1' : 'min-h-6',
            )}
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="text-foreground font-mono text-xs break-all">
                {name}
              </span>{' '}
              <span className="text-muted-foreground text-xs">
                {notes.join(' · ')}
              </span>
            </span>
            {comfortable && field.description !== undefined ? (
              <span className="text-muted-foreground text-xs">
                {field.description}
              </span>
            ) : null}
            {comfortable ? (
              <Rows
                schema={field}
                path={fieldPath}
                density={density}
                maxRows={undefined}
                tagOf={tagOf}
                maybeEmpty={maybeEmpty}
                t={t}
                locale={locale}
                nested
              />
            ) : null}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li
          className={cn(
            'text-muted-foreground flex items-center text-xs',
            comfortable ? 'min-h-8' : 'min-h-6',
          )}
        >
          {t('more', { count: hidden })}
        </li>
      ) : null}
    </ul>
  );
}

export function SchemaTree({
  schema,
  density = 'comfortable',
  maxRows,
  tagOf,
  maybeEmpty,
  typeScript,
  'aria-label': ariaLabel,
  className,
}: SchemaTreeProps) {
  const { t } = useT('schemaTree');
  // The UI language decides the quotes and the "or" of a list of kinds.
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const hasFields = fieldsOf(schema) !== null;
  return (
    <div
      data-slot="schema-tree"
      className={cn('flex flex-col gap-2', className)}
    >
      {hasFields ? (
        <Rows
          schema={schema}
          path={[]}
          density={density}
          maxRows={maxRows}
          tagOf={tagOf}
          maybeEmpty={maybeEmpty}
          t={t}
          locale={locale}
          label={ariaLabel ?? t('label')}
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          {schemaKindLabel(t, schema, locale)}
        </p>
      )}
      {typeScript !== undefined ? (
        <CollapsibleDetails variant="compact" summary={t('asTypeScript')}>
          <HighlightedCode
            code={typeScript}
            language="typescript"
            showLineNumbers={false}
            className="bg-bg-elevated border-border-base mt-2 rounded-md border text-xs [&_pre]:text-xs"
          />
        </CollapsibleDetails>
      ) : null}
    </div>
  );
}

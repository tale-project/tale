'use client';

import {
  type ChangeItem,
  ChangeList,
  type ChangeSection,
  FieldChangeRow,
} from '@tale/ui/change-list';
import { CodeDiff, type CodeDiffProps } from '@tale/ui/code-diff';
import { DataDiff } from '@tale/ui/data-diff';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { FlaskConical, ListTree, LogIn, LogOut, Package } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { documentYaml } from '@/lib/engine/api/document-yaml';
import type {
  AutomationDiff,
  FieldChange,
  InputsDiff,
  NodeDiff,
} from '@/lib/engine/core/diff/automation';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { END_ID, START_ID } from '../../lib/flow-ids';
import { fieldEditor } from '../../lib/inspector-fields';
import { fieldName } from '../../lib/issue-text';
import {
  catalogLabel,
  type NodeCatalogView,
  nodeIcon,
  nodeTitle,
} from '../../lib/node-face';
import {
  nodeChangeSummary,
  referencesUpdatedBy,
  testChangeSummary,
  testFieldName,
} from '../../lib/version-changes';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type CodeLanguage = CodeDiffProps['language'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The two sides of a comparison, by their version labels ("v4", "v5"). */
export interface CompareLabels {
  before: string;
  after: string;
}

/** A value as one line or block of text: a string as written, anything
 * else as indented JSON. */
function asText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

/** The editor's language for a code-like field, else the display's. */
function codeLanguageOf(
  change: FieldChange,
  node: NodeDef | null,
): { language: CodeLanguage; templates: boolean } {
  if (node !== null) {
    const editor = fieldEditor(
      node,
      change.field,
      change.after ?? change.before,
    );
    if (editor.kind === 'code') {
      return { language: editor.language, templates: editor.templates };
    }
  }
  if (change.display === 'code') {
    return { language: 'javascript', templates: false };
  }
  if (change.display === 'condition') {
    return { language: 'expression', templates: false };
  }
  return { language: 'template', templates: true };
}

/** One field's change, shown the way its kind of value reads best. */
function FieldRow({
  change,
  label,
  node,
  labels,
  note,
}: {
  change: FieldChange;
  /** The field's name where it is edited: a node's field as its inspector
   * labels it, a test's as the test form does, a part of the version by its
   * row's title. */
  label: string;
  node: NodeDef | null;
  labels: CompareLabels;
  note?: ReactNode;
}) {
  const values = {
    ...(change.before !== undefined && { before: asText(change.before) }),
    ...(change.after !== undefined && { after: asText(change.after) }),
  };
  switch (change.display) {
    case 'code':
    case 'template':
    case 'condition': {
      const { language, templates } = codeLanguageOf(change, node);
      return (
        <FieldChangeRow
          label={label}
          kind={change.kind}
          {...(note !== undefined && { note })}
          detail={
            <CodeDiff
              aria-label={label}
              before={asText(change.before)}
              after={asText(change.after)}
              language={language}
              templates={templates}
              beforeLabel={labels.before}
              afterLabel={labels.after}
              toolbar={false}
              context={2}
            />
          }
        />
      );
    }
    case 'json':
    case 'list':
      return change.kind === 'changed' ? (
        <FieldChangeRow
          label={label}
          kind={change.kind}
          {...(note !== undefined && { note })}
          detail={
            <DataDiff
              aria-label={label}
              before={change.before}
              after={change.after}
              labels={labels}
            />
          }
        />
      ) : (
        <FieldChangeRow
          label={label}
          kind={change.kind}
          layout="stacked"
          {...values}
          {...(note !== undefined && { note })}
        />
      );
    case 'text':
      return (
        <FieldChangeRow
          label={label}
          kind={change.kind}
          layout="stacked"
          {...values}
          {...(note !== undefined && { note })}
        />
      );
    default:
      return (
        <FieldChangeRow
          label={label}
          kind={change.kind}
          {...values}
          {...(note !== undefined && { note })}
        />
      );
  }
}

/** A whole definition that only one version has, as the YAML it reads. */
function WholeDefinition({
  label,
  value,
  kind,
  labels,
}: {
  /** Names the comparison: the node's, the test's or the input's title. */
  label: string;
  value: unknown;
  kind: 'added' | 'removed';
  labels: CompareLabels;
}) {
  const text = isRecord(value) ? documentYaml(value) : asText(value);
  return (
    <CodeDiff
      aria-label={label}
      before={kind === 'removed' ? text : ''}
      after={kind === 'added' ? text : ''}
      language="yaml"
      templates
      beforeLabel={labels.before}
      afterLabel={labels.after}
      toolbar={false}
    />
  );
}

function nodeAt(doc: Automation | null, index: number | undefined) {
  return doc === null || index === undefined
    ? null
    : (doc.nodes[index] ?? null);
}

/** The words of an input's change: whether it became required, and its
 * type before and after. */
function inputSummary(input: InputsDiff, t: Translate): string | undefined {
  const parts: string[] = [];
  if (input.required !== undefined) {
    parts.push(
      t(
        input.required.after
          ? 'compare.inputs.nowRequired'
          : 'compare.inputs.noLongerRequired',
      ),
    );
  }
  if (
    input.kind === 'changed' &&
    input.typeBefore !== input.typeAfter &&
    (input.typeBefore !== undefined || input.typeAfter !== undefined)
  ) {
    parts.push(
      t('compare.inputs.type', {
        before: input.typeBefore ?? '—',
        after: input.typeAfter ?? '—',
      }),
    );
  }
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const PACKAGE_FIELD_KEYS: Readonly<Record<string, string>> = {
  settings: 'compare.package.settings',
  taskContract: 'compare.package.taskContract',
  presentation: 'compare.package.presentation',
};

/**
 * The sections a comparison reads as: Start (the run's inputs), the nodes,
 * End (the output), the tests, and the version's package data — each item
 * a change's badge, its title and a few words, opening to its fields. The
 * node items are keyed `node:<id>` by their id in the later version.
 */
export function useVersionChangeSections({
  diff,
  before,
  after,
  labels,
  catalog,
}: {
  /** Null while either version is still loading: no sections yet. */
  diff: AutomationDiff | null;
  before: Automation | null;
  after: Automation | null;
  labels: CompareLabels;
  catalog: NodeCatalogView;
}): ChangeSection[] {
  const { t } = useT('automations');
  const { locale } = useLocale();
  return useMemo(() => {
    if (diff === null || after === null) return [];
    const faceContext = {
      t,
      locale,
      catalog,
      returns: { status: 'off' as const, outputs: null },
    };
    const updatedBy = referencesUpdatedBy(diff);

    const nodeItem = (node: NodeDiff): ChangeItem => {
      const definition =
        node.kind === 'removed'
          ? nodeAt(before, node.beforeIndex)
          : nodeAt(after, node.afterIndex);
      const otherSide =
        node.kind === 'renamed' || node.kind === 'changed'
          ? nodeAt(after, node.afterIndex)
          : definition;
      const summary =
        node.kind === 'renamed' && node.renamedFrom !== undefined
          ? [
              t('compare.renamedFrom', { name: nodeTitle(node.renamedFrom) }),
              nodeChangeSummary(node, { t, locale }),
            ]
              .filter((part) => part !== undefined)
              .join(' · ')
          : nodeChangeSummary(node, { t, locale });
      const updated = updatedBy.get(node.id);
      const detail =
        node.kind === 'added' || node.kind === 'removed' ? (
          <WholeDefinition
            label={nodeTitle(node.id)}
            value={definition}
            kind={node.kind}
            labels={labels}
          />
        ) : node.fields.length > 0 || updated !== undefined ? (
          <div className="flex flex-col gap-3">
            {node.fields.map((field) => (
              <FieldRow
                key={field.field}
                change={field}
                label={fieldName(t, field.field)}
                node={otherSide}
                labels={labels}
              />
            ))}
            {updated !== undefined && (
              <Text variant="caption">
                {t('compare.alsoUpdated', { count: updated })}
              </Text>
            )}
          </div>
        ) : undefined;
      return {
        id: `node:${node.id}`,
        kind: node.kind,
        title: nodeTitle(node.id),
        icon: definition === null ? ListTree : nodeIcon(definition, catalog),
        ...(definition !== null && {
          subtitle: catalogLabel(definition, faceContext),
        }),
        ...(summary !== undefined && summary !== '' && { summary }),
        ...(detail !== undefined && { detail }),
      };
    };

    const fieldItem = (
      id: string,
      title: string,
      change: FieldChange,
      icon: ChangeItem['icon'],
    ): ChangeItem => ({
      id,
      kind: change.kind,
      title,
      icon,
      // The output is shown on End; package data has no box.
      ...(graphBoxOf(id) === null && { activatable: false }),
      detail: (
        <FieldRow change={change} label={title} node={null} labels={labels} />
      ),
    });

    const start: ChangeItem[] = diff.inputs.map((input) => {
      const summary = inputSummary(input, t);
      const title = input.property ?? t('compare.inputs.schema');
      return {
        id: `input:${input.property ?? ''}`,
        kind: input.kind,
        title,
        icon: LogIn,
        ...(summary !== undefined && { summary }),
        detail:
          input.kind === 'changed' ? (
            <DataDiff
              aria-label={title}
              before={input.before}
              after={input.after}
              labels={labels}
            />
          ) : (
            <WholeDefinition
              label={title}
              value={input.kind === 'added' ? input.after : input.before}
              kind={input.kind}
              labels={labels}
            />
          ),
      };
    });
    const end: ChangeItem[] = [
      ...(diff.output === null
        ? []
        : [
            fieldItem(
              'end:output',
              t('versions.flags.output'),
              diff.output,
              LogOut,
            ),
          ]),
      ...(diff.description === null
        ? []
        : [
            fieldItem(
              'end:description',
              t('versions.flags.description'),
              diff.description,
              LogOut,
            ),
          ]),
    ];
    const tests: ChangeItem[] = diff.tests.map((test) => {
      const summary = testChangeSummary(test, { t, locale });
      const definition =
        test.kind === 'removed'
          ? before?.tests?.[test.beforeIndex ?? -1]
          : after.tests?.[test.afterIndex ?? -1];
      return {
        id: `test:${test.name}`,
        kind: test.kind,
        title: test.name,
        icon: FlaskConical,
        // A test has no box on the graph.
        activatable: false,
        ...(summary !== undefined && { summary }),
        detail:
          test.kind === 'changed' ? (
            <div className="flex flex-col gap-3">
              {test.fields.map((field) => (
                <FieldRow
                  key={field.field}
                  change={field}
                  label={testFieldName(t, field.field)}
                  node={null}
                  labels={labels}
                />
              ))}
            </div>
          ) : (
            <WholeDefinition
              label={test.name}
              value={definition}
              kind={test.kind}
              labels={labels}
            />
          ),
      };
    });
    const packageData: ChangeItem[] = [
      ...diff.package.map((change) =>
        fieldItem(
          `package:${change.field}`,
          PACKAGE_FIELD_KEYS[change.field] === undefined
            ? change.field
            : t(PACKAGE_FIELD_KEYS[change.field]),
          change,
          Package,
        ),
      ),
      ...diff.other.map((change) =>
        fieldItem(`other:${change.field}`, change.field, change, Package),
      ),
    ];
    return [
      {
        id: 'start',
        title: t('compare.sections.start'),
        items: start,
      },
      {
        id: 'nodes',
        title: t('compare.sections.nodes'),
        items: diff.nodes.map(nodeItem),
      },
      { id: 'end', title: t('compare.sections.end'), items: end },
      { id: 'tests', title: t('compare.sections.tests'), items: tests },
      {
        id: 'package',
        title: t('compare.sections.package'),
        items: packageData,
      },
    ].filter((section) => section.items.length > 0);
  }, [diff, before, after, labels, catalog, t, locale]);
}

/** The graph's box an item of the list is shown on: a node's own box, Start
 * for the run's inputs, End for the output; none for a test or package
 * data. */
export function graphBoxOf(itemId: string): string | null {
  if (itemId.startsWith('node:')) return itemId.slice('node:'.length);
  if (itemId.startsWith('input:')) return START_ID;
  if (itemId.startsWith('end:')) return END_ID;
  return null;
}

/** The list's items a box of the graph stands for. */
export function itemsOfBox(
  sections: readonly ChangeSection[],
  box: string,
): ChangeItem[] {
  return sections
    .flatMap((section) => section.items)
    .filter((item) => graphBoxOf(item.id) === box);
}

/**
 * Every change of a comparison as a list, grouped in sections; a row of a
 * node, an input or the output offers **Show on the graph**. What a version never holds — its trigger,
 * its projects — is said under the list.
 */
export function VersionChanges({
  sections,
  activeId,
  onShowOnGraph,
  note = true,
}: {
  sections: readonly ChangeSection[];
  activeId?: string | null;
  onShowOnGraph?: (nodeId: string) => void;
  /** Says under the list what a version never holds; left out where the
   * list shows one item. */
  note?: boolean;
}) {
  const { t } = useT('automations');
  return (
    <div className="flex flex-col gap-3">
      <ChangeList
        sections={sections}
        aria-label={t('compare.views.changes')}
        defaultExpanded="first"
        {...(activeId !== undefined && { activeId })}
        {...(onShowOnGraph !== undefined && {
          activateLabel: t('compare.showOnGraph'),
          onActivate: (item: ChangeItem) => {
            const box = graphBoxOf(item.id);
            if (box !== null) onShowOnGraph(box);
          },
        })}
      />
      {note && (
        <Text variant="caption">{t('compare.footer.notVersioned')}</Text>
      )}
    </div>
  );
}

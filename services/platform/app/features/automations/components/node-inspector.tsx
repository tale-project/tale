'use client';

import { Alert } from '@tale/ui/alert';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import {
  CodeEditor,
  type CodeEditorDiagnostic,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import type { CodeEditorProviders } from '@tale/ui/code-editor/providers';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Field } from '@tale/ui/field';
import {
  FieldIssueMessages,
  fieldIssuesHaveError,
  type FieldIssue,
} from '@tale/ui/field-issue-messages';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { useIssueFocusTarget } from '@tale/ui/issue-focus';
import { IssueList } from '@tale/ui/issue-list';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { SectionHeader } from '@tale/ui/section-header';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Tabs } from '@tale/ui/tabs';
import { useCopyButton } from '@tale/ui/use-copy';
import { AlertTriangle, Check, Copy, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { FlowFacts } from '@/lib/engine/core/analysis/flow';
import { ptr } from '@/lib/engine/core/syntax/pointer';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import type {
  AnalysisView,
  TypesView,
} from '@/lib/shared/schemas/automation-issues';

import type { NodeTypeSummary } from '../hooks/backend';
import { useDeselectOnEscape } from '../hooks/use-deselect-on-escape';
import { fieldDiagnostics, type FieldTextKind } from '../lib/code-diagnostics';
import { automationProviders } from '../lib/code-providers';
import {
  conditionText,
  describeList,
  renderOperand,
} from '../lib/condition-text';
import type { RawDocument } from '../lib/draft-document';
import { outputReaders } from '../lib/flow-graph';
import { END_ID } from '../lib/flow-ids';
import { deriveEdges } from '../lib/graph';
import {
  declaredInspectorFields,
  fieldEditor,
  shownControlFlowFields,
  type FieldEditor,
} from '../lib/inspector-fields';
import { fieldIssueMessage, type AutomationIssueView } from '../lib/issues';
import {
  catalogLabel,
  connectorName,
  coreTypeWord,
  nodeFace,
  nodeTitle,
  type NodeCatalogView,
} from '../lib/node-face';
import type { NodeRunView } from '../lib/run-view';
import { engineTemplateScan } from '../lib/template-scanner';
import { AgentNodeFields } from './agent-node-fields';
import { JsonCodeField, jsonFieldText } from './json-code-field';
import { LlmModelField } from './llm-model-field';
import { NodeFlowSummary } from './node-flow-summary';
import { NodeShapePanel, type ShapeStatus } from './node-shape-panel';
import { RunStepDetail, type RunStepRecord } from './run-step-detail';

/**
 * What the inspector reads besides the node: the document it is in, the
 * flow facts and the draft check's answer, the catalog's words, and a way
 * to pick another box on the canvas.
 */
export interface InspectorContext {
  /** The document on screen, as the inspector reads it. */
  doc: Automation;
  /** The document's flow facts; null on a reference cycle. */
  flow: FlowFacts | null;
  analysis: AnalysisView | null;
  types: TypesView | null;
  /** Where the draft check stands, for the Shape tab; `off` hides it. */
  shapeStatus: ShapeStatus | 'off';
  /** Where the draft check stands, for the marks in the code fields. */
  diagnosticsStatus: CodeEditorDiagnosticsStatus;
  /** The document the check answered for: its ranges index into it. */
  settled: RawDocument | null;
  catalog: NodeCatalogView;
  modelLabel?: (id: string) => string | undefined;
  /** Picks a box on the canvas: a node, Start or End. */
  onSelect?: (id: string) => void;
  /** What a node returned in the run laid over the canvas. */
  sampleOf?: (nodeId: string) => unknown;
}

/**
 * Read one declared field off a node by name. `NodeDef` carries no index
 * signature — the engine REGISTRY, not the type, decides which fields a given
 * node type accepts — so the lookup goes through a record view of the same
 * object rather than asserting the runtime name into the key union.
 */
function readNodeField(node: NodeDef, field: string): unknown {
  const record: Record<string, unknown> = { ...node };
  return record[field];
}

/** The field's value in the document the check answered for, when that
 *  document still has this node at this place. */
function settledField(
  settled: RawDocument | null,
  nodeIndex: number | undefined,
  node: NodeDef,
  field: string,
): unknown {
  if (settled === null || nodeIndex === undefined) {
    return readNodeField(node, field);
  }
  const nodes = settled.nodes;
  const raw: unknown = Array.isArray(nodes) ? nodes[nodeIndex] : undefined;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Reflect.get(raw, 'id') !== node.id
  ) {
    return readNodeField(node, field);
  }
  return Reflect.get(raw, field);
}

/** Where a field's problems are, and what they say under its control. */
interface FieldIssueProps {
  /** The field's pointer in the document (`/nodes/2/prompt`): "go to" a
   * problem there, or inside it, lands on this control. */
  anchor?: string | null;
  issues?: readonly FieldIssue[];
  /** Opens what hides the control before "go to" focuses it. */
  reveal?: () => void;
}

/** A text field, with its label really tied to its control. */
function TextField({
  label,
  description,
  required,
  value,
  readOnly,
  onChange,
  anchor = null,
  issues,
  reveal,
}: {
  label: string;
  description?: string;
  required?: boolean;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
} & FieldIssueProps) {
  const id = useId();
  const controlRef = useRef<HTMLInputElement>(null);
  // The box shows the field's string as it is stored, so a problem's range
  // inside it selects exactly the offending text.
  useIssueFocusTarget(
    anchor,
    controlRef,
    reveal === undefined ? undefined : { reveal },
  );
  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(required !== undefined && { required })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
    >
      <Input
        ref={controlRef}
        id={id}
        readOnly={readOnly}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

/** A field written in code, a template or a prompt. */
function CodeField({
  label,
  description,
  required,
  editor,
  value,
  readOnly,
  onChange,
  anchor = null,
  issues,
  reveal,
  diagnostics,
  diagnosticsFor,
  diagnosticsStatus,
  providers,
}: {
  label: string;
  description?: string;
  required?: boolean;
  editor: Extract<FieldEditor, { kind: 'code' }>;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  diagnostics?: readonly CodeEditorDiagnostic[];
  diagnosticsFor?: string;
  diagnosticsStatus?: CodeEditorDiagnosticsStatus;
  providers?: CodeEditorProviders;
} & FieldIssueProps) {
  const id = useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(required !== undefined && { required })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
    >
      <CodeEditor
        id={id}
        value={value}
        onChange={onChange}
        language={editor.language}
        templates={editor.templates}
        {...(editor.templates && { templateScanner: engineTemplateScan })}
        font={editor.font}
        singleLine={editor.singleLine}
        minRows={editor.minRows}
        maxRows={editor.maxRows}
        lineNumbers={editor.lineNumbers}
        expandable={editor.expandable && !readOnly ? { title: label } : false}
        readOnly={readOnly}
        {...(required === true && { required })}
        issueAnchor={anchor}
        {...(reveal !== undefined && { issueReveal: reveal })}
        {...(diagnostics !== undefined && { diagnostics })}
        {...(diagnosticsFor !== undefined && { diagnosticsFor })}
        {...(diagnosticsStatus !== undefined && { diagnosticsStatus })}
        {...(providers !== undefined && { providers })}
        describeDiagnostics={false}
      />
    </Field>
  );
}

/** Maximum repeats: a whole number from 1 to 20, or empty for the
 *  engine's default. A value out of range is refused with the reason and
 *  never reaches the node. */
function MaxRepeatsField({
  value,
  readOnly,
  onChange,
  anchor = null,
  issues,
  reveal,
}: {
  value: number | undefined;
  readOnly: boolean;
  onChange: (next: number | undefined) => void;
} & FieldIssueProps) {
  const { t } = useT('automations');
  const id = useId();
  const controlRef = useRef<HTMLInputElement>(null);
  useIssueFocusTarget(
    anchor,
    controlRef,
    reveal === undefined ? undefined : { reveal },
  );
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText((current) => {
      const shown = current.trim() === '' ? undefined : Number(current);
      return shown === value
        ? current
        : value === undefined
          ? ''
          : String(value);
    });
  }, [value]);
  return (
    <Field
      label={t('editor.fields.maxRepeats')}
      htmlFor={id}
      description={t('editor.fields.maxRepeatsDescription')}
      {...(error !== null && { error })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
    >
      <Input
        ref={controlRef}
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={20}
        step={1}
        placeholder="5"
        readOnly={readOnly}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') {
            setError(null);
            onChange(undefined);
            return;
          }
          const parsed = Number(next);
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
            setError(t('editor.fields.maxRepeatsRange'));
            return;
          }
          setError(null);
          onChange(parsed);
        }}
      />
    </Field>
  );
}

/** What a condition field is for, under it while it is empty. */
const CONDITION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  when: 'editor.fields.whenDescription',
  forEach: 'editor.fields.forEachDescription',
  repeatUntil: 'editor.fields.repeatUntilDescription',
};

/** The `__none__` choice of Else of: the node has no partner. */
const ELSE_OF_NONE = '__none__';

/** Else of: the node with a condition this one is the otherwise of. */
function ElseOfField({
  node,
  doc,
  readOnly,
  onChange,
  anchor = null,
  issues,
  reveal,
}: {
  node: NodeDef;
  doc: Automation;
  readOnly: boolean;
  onChange: (next: string | undefined) => void;
} & FieldIssueProps) {
  const { t } = useT('automations');
  const id = useId();
  useIssueFocusTarget(
    anchor,
    {
      focus: () => document.getElementById(id)?.focus(),
      ...(reveal !== undefined && { reveal }),
    },
    reveal === undefined ? undefined : { reveal },
  );
  // Nodes with a condition — not this node, and not one that is already
  // the otherwise of this one, which would make the two wait on each other.
  const candidates = doc.nodes.filter(
    (other) =>
      other.id !== node.id &&
      typeof other.when === 'string' &&
      other.when !== '' &&
      other.elseOf !== node.id,
  );
  const current = node.elseOf;
  const options = [
    { value: ELSE_OF_NONE, label: t('editor.fields.elseOfNone') },
    ...candidates.map((other) => ({
      value: other.id,
      label: nodeTitle(other.id),
      description: other.id,
    })),
    // A stored partner the list would not offer stays shown; the check
    // says what is wrong with it.
    ...(current !== undefined &&
    current !== '' &&
    !candidates.some((other) => other.id === current)
      ? [{ value: current, label: current }]
      : []),
  ];
  const explain =
    current !== undefined && current !== ''
      ? t('editor.explain.elseOf', { node: nodeTitle(current) })
      : candidates.length === 0
        ? t('editor.fields.elseOfEmpty')
        : t('editor.fields.elseOfDescription');
  return (
    <div className="flex flex-col gap-1.5">
      <SearchableSelect
        id={id}
        label={t('editor.fields.elseOf')}
        description={explain}
        error={fieldIssuesHaveError(issues)}
        value={current === undefined || current === '' ? ELSE_OF_NONE : current}
        options={options}
        disabled={readOnly}
        onValueChange={(next) => {
          onChange(next === ELSE_OF_NONE ? undefined : next);
        }}
      />
      <FieldIssueMessages issues={issues} idPrefix={`${id}-issue`} />
    </div>
  );
}

/** On error: stop the run, or go on without this node. */
function OnErrorField({
  value,
  readOnly,
  onChange,
  anchor = null,
  issues,
  reveal,
}: {
  value: NodeDef['onError'];
  readOnly: boolean;
  onChange: (next: 'continue' | undefined) => void;
} & FieldIssueProps) {
  const { t } = useT('automations');
  const id = useId();
  const descriptionId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  useIssueFocusTarget(
    anchor,
    {
      focus: () =>
        groupRef.current
          ?.querySelector<HTMLElement>('[data-state="on"], button')
          ?.focus(),
    },
    reveal === undefined ? undefined : { reveal },
  );
  return (
    <div ref={groupRef} className="flex flex-col gap-1.5">
      <SegmentedControl
        id={id}
        label={t('editor.fields.onError')}
        value={value === 'continue' ? 'continue' : 'fail'}
        disabled={readOnly}
        options={[
          { value: 'fail', label: t('editor.fields.onErrorStop') },
          { value: 'continue', label: t('editor.fields.onErrorContinue') },
        ]}
        onValueChange={(next) => {
          onChange(next === 'continue' ? 'continue' : undefined);
        }}
      />
      <p
        id={descriptionId}
        className="text-xs text-[color:var(--color-fg-muted)]"
      >
        {t('editor.fields.onErrorDescription')}
      </p>
      <FieldIssueMessages issues={issues} idPrefix={`${id}-issue`} />
    </div>
  );
}

/** The node's id, monospaced, with a button that copies it: authors and
 *  agents reference a node by its id. */
function NodeIdRow({ nodeId }: { nodeId: string }) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { copied, onClick } = useCopyButton(nodeId);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="text-muted-foreground truncate font-mono text-xs">
        {nodeId}
      </code>
      <IconButton
        icon={copied ? Check : Copy}
        size="sm"
        iconSize={3}
        className="size-6 shrink-0"
        aria-label={t('editor.inspector.copyId')}
        title={t('editor.inspector.copyId')}
        onClick={onClick}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </div>
  );
}

export interface NodeInspectorProps {
  /** The region id the canvas's selected node button points at. */
  id: string;
  /** The node picked on the canvas. The inspector exists only while one is:
   * with nothing picked the canvas has the whole width. */
  node: NodeDef;
  /** The node's registry entry, when the catalog knows the type. */
  nodeType: NodeTypeSummary | undefined;
  /** The node-type catalog could not be loaded at all. */
  catalogUnavailable?: boolean;
  /** What the overlaid run did to this node, when one is shown. */
  runView?: NodeRunView | undefined;
  /** The node's step in the run's record. */
  runRecord?: RunStepRecord | undefined;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
  /** For the agent node's equipment pickers (skills/connectors/tools/secrets
   * catalogs are org-scoped, widened to the project when authored in one). */
  organizationId: string;
  projectId?: string;
  /** Clears the canvas selection — Close, Escape, and click-again share this. */
  onDeselect?: () => void;
  /**
   * `card` (default) — a bordered, rounded card in the page inset, as a run's
   * page shows it. `panel` — flush against the canvas in the Editor tab's
   * edge-to-edge workbench, bordered only on the side that meets it.
   */
  variant?: 'card' | 'panel';
  /** The problems the editor's check found on this node. */
  issues?: readonly AutomationIssueView[];
  /** The node's position in the document — its problems' pointers name it. */
  nodeIndex?: number;
  context: InspectorContext;
  /** The tab it opens on; a run's page opens on what the run did. */
  defaultTab?: InspectorTab;
}

/** The inspector's frame: a card in a page inset, or a panel flush
 *  against the canvas. Shared by the node, Start and End inspectors. */
export function InspectorFrame({
  id,
  labelledBy,
  focusKey,
  variant,
  onDeselect,
  children,
}: {
  id: string;
  labelledBy: string;
  /** A new key moves focus into the frame and scrolls it to the top. */
  focusKey: string;
  variant: 'card' | 'panel';
  onDeselect?: () => void;
  children: React.ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  useDeselectOnEscape(true, onDeselect);
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    section.scrollTop = 0;
    section.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={labelledBy}
      className={cn(
        'border-border flex h-full max-h-[70dvh] min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 outline-none lg:max-h-none',
        variant === 'card'
          ? 'bg-card rounded-lg border'
          : // Its one border faces the canvas: above the panel where the two
            // stack, beside it from `lg` up.
            'bg-background border-t lg:border-t-0 lg:border-l',
      )}
    >
      {children}
    </section>
  );
}

/**
 * The inspector beside the canvas, for the node picked on it.
 *
 * Clicking a box opens this panel with that node's fields; clicking the same
 * box again, Close, Escape (when not typing), or the empty canvas closes it
 * and hands the width back to the canvas — the automation's own settings
 * (trigger, projects) are its General tab. Focus moves into this panel on
 * select so Tab reaches the fields next.
 *
 * It edits the document, not a model of it: the id and type identify the node,
 * the control-flow fields are the engine's own declarative branching and
 * iteration, and the remaining fields are exactly the ones the node type
 * declares. When a run is overlaid the same panel shows what that run did here.
 */
export function NodeInspector({
  id,
  node,
  variant = 'card',
  onDeselect,
  ...rest
}: NodeInspectorProps) {
  const headingId = useId();
  return (
    <InspectorFrame
      id={id}
      labelledBy={headingId}
      focusKey={node.id}
      variant={variant}
      {...(onDeselect !== undefined && { onDeselect })}
    >
      <NodeFields
        // Each node opens on its own fields: its disclosures start from its
        // own state, and no half-typed JSON follows the reader to the next.
        key={node.id}
        headingId={headingId}
        node={node}
        {...(onDeselect !== undefined && { onDeselect })}
        {...rest}
      />
    </InspectorFrame>
  );
}

export type InspectorTab = 'fields' | 'shape' | 'run';

export interface NodeFieldsProps {
  headingId: string;
  node: NodeDef;
  nodeType: NodeTypeSummary | undefined;
  catalogUnavailable?: boolean;
  runView?: NodeRunView | undefined;
  runRecord?: RunStepRecord | undefined;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
  organizationId: string;
  projectId?: string;
  onDeselect?: () => void;
  /** The problems the editor's check found on this node. */
  issues?: readonly AutomationIssueView[];
  /** The node's position in the document — its problems' pointers name it. */
  nodeIndex?: number;
  context: InspectorContext;
  defaultTab?: InspectorTab;
}

const NO_ISSUE_VIEWS: readonly AutomationIssueView[] = [];

/** The tab bar of an inspector: Fields, Shape (while the check can say),
 *  Last run (while a run is laid over the canvas). */
export function useInspectorTab(
  hasShape: boolean,
  hasRun: boolean,
  defaultTab: InspectorTab = 'fields',
): [InspectorTab, (tab: InspectorTab) => void] {
  const [tab, setTab] = useState<InspectorTab>(defaultTab);
  const shown: InspectorTab =
    (tab === 'shape' && !hasShape) || (tab === 'run' && !hasRun)
      ? 'fields'
      : tab;
  return [shown, setTab];
}

function isInspectorTab(value: string): value is InspectorTab {
  return value === 'fields' || value === 'shape' || value === 'run';
}

/** The three tabs, with each panel kept mounted so a half-typed field
 *  survives a look at the shapes. */
export function InspectorTabs({
  tab,
  onTabChange,
  fields,
  shape,
  run,
}: {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  fields: React.ReactNode;
  shape?: React.ReactNode;
  run?: React.ReactNode;
}) {
  const { t } = useT('automations');
  const panel = (content: React.ReactNode) => (
    <div className="flex flex-col gap-3 pt-3">{content}</div>
  );
  return (
    <Tabs
      variant="underline"
      keepMounted
      value={tab}
      onValueChange={(next) => {
        if (isInspectorTab(next)) onTabChange(next);
      }}
      listClassName="gap-3"
      items={[
        {
          value: 'fields',
          label: t('editor.inspector.tabs.fields'),
          content: panel(fields),
        },
        ...(shape === undefined
          ? []
          : [
              {
                value: 'shape',
                label: t('editor.inspector.tabs.shape'),
                content: panel(shape),
              },
            ]),
        ...(run === undefined
          ? []
          : [
              {
                value: 'run',
                label: t('editor.inspector.tabs.run'),
                content: panel(run),
              },
            ]),
      ]}
    />
  );
}

/** The check's state as the code editor marks it. */
type FieldMarks = {
  diagnostics: readonly CodeEditorDiagnostic[];
  diagnosticsFor: string;
};

/**
 * The node's own fields, with no outer chrome — `NodeInspector`'s `card` and
 * `panel` variants wrap this in a bordered section; the Editor tab's mobile
 * sheet (`AutomationEditor`) renders it directly inside a `ResponsiveDialog`
 * instead, since a sheet's chrome is the dialog's, not this component's.
 *
 * The header names the node, says what kind it is and gives its id to
 * copy; "When it runs" says how often it runs and what happens when it
 * fails. Then three tabs: the fields, the shapes the check worked out,
 * and what the overlaid run did here.
 *
 * Problems the editor's check found show where they are fixed: under the
 * field's control and at their characters in a code field, or — for a part
 * of the node without a box of its own (a model picker, an unknown field,
 * the node as a whole) — in a list at the top. Each control registers where
 * "go to" a problem lands.
 */
export function NodeFields({
  headingId,
  node,
  nodeType,
  catalogUnavailable = false,
  runView,
  runRecord,
  readOnly,
  onChange,
  organizationId,
  projectId,
  onDeselect,
  issues = NO_ISSUE_VIEWS,
  nodeIndex,
  context,
  defaultTab,
}: NodeFieldsProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const isAgent = node.type === 'agent';
  const declaredFields = declaredInspectorFields(
    node,
    nodeType?.allowedFields ?? [],
  );
  const controlFlowFields = shownControlFlowFields(node);
  const required = new Set(nodeType?.requiredFields ?? []);
  const fieldViews = useMemo(() => {
    const byField = new Map<string, AutomationIssueView[]>();
    for (const view of issues) {
      if (view.navigation.kind !== 'field') continue;
      const list = byField.get(view.navigation.field) ?? [];
      list.push(view);
      byField.set(view.navigation.field, list);
    }
    return byField;
  }, [issues]);
  const issuesByField = useMemo(() => {
    const byField = new Map<string, FieldIssue[]>();
    for (const [field, views] of fieldViews) {
      byField.set(
        field,
        views.map((view) => ({
          id: view.issue.id,
          severity: view.issue.level,
          message: fieldIssueMessage(view, t),
        })),
      );
    }
    return byField;
  }, [fieldViews, t]);
  const nodeIssues = useMemo(
    () =>
      issues.flatMap((view) =>
        view.navigation.kind === 'node' ? [view.item] : [],
      ),
    [issues],
  );
  const hasControlFlow = controlFlowFields.some(
    (field) =>
      readNodeField(node, field) !== undefined ||
      (issuesByField.get(field)?.length ?? 0) > 0,
  );
  const [tab, setTab] = useInspectorTab(
    context.shapeStatus !== 'off',
    runView !== undefined,
    defaultTab,
  );
  const controlFlowRef = useRef<HTMLDetailsElement>(null);
  /** Opens the tab and the disclosure a field sits in. */
  const revealOf = (field: string) => () => {
    setTab('fields');
    if (
      (controlFlowFields as readonly string[]).includes(field) &&
      controlFlowRef.current !== null
    ) {
      controlFlowRef.current.open = true;
    }
  };
  /** Where "go to" lands for a problem in `field` (or inside it). */
  const anchorOf = (field: string): string | null =>
    nodeIndex === undefined ? null : ptr('nodes', nodeIndex, field);
  // A problem with the node as a whole lands on its name, right above the
  // list that names it.
  const headingRef = useRef<HTMLSpanElement>(null);
  useIssueFocusTarget(
    nodeIndex === undefined ? null : ptr('nodes', nodeIndex),
    headingRef,
  );
  const nodeIssuesTitleId = useId();

  const { doc, types, settled, catalog } = context;
  const faceContext = useMemo(
    () => ({
      t,
      locale,
      catalog,
      ...(context.modelLabel !== undefined && {
        modelLabel: context.modelLabel,
      }),
      returns: { status: 'off' as const, outputs: null },
    }),
    [t, locale, catalog, context.modelLabel],
  );
  const face = nodeFace(node, faceContext);
  const conditionContext = useMemo(
    () => ({ t, locale, nodeLabel: nodeTitle }),
    [t, locale],
  );
  const readers = useMemo(
    () =>
      deriveEdges(doc.nodes)
        .filter((edge) => edge.kind === 'data' && edge.source === node.id)
        .map((edge) => edge.target),
    [doc.nodes, node.id],
  );
  const readByOutput = useMemo(
    () => outputReaders(doc).includes(node.id),
    [doc, node.id],
  );

  /** One field's problems as marks at their characters. */
  const marksOf = (field: string, kind: FieldTextKind): FieldMarks => {
    const value = settledField(settled, nodeIndex, node, field);
    const text =
      kind === 'string'
        ? typeof value === 'string'
          ? value
          : ''
        : jsonFieldText(value);
    const views = fieldViews.get(field) ?? [];
    return {
      diagnostics:
        nodeIndex === undefined || views.length === 0
          ? []
          : fieldDiagnostics({
              views,
              fieldPointer: ptr('nodes', nodeIndex, field),
              text,
              kind,
              t,
            }),
      diagnosticsFor: text,
    };
  };
  const providersOf = (
    source: Parameters<typeof automationProviders>[0]['field'],
  ): CodeEditorProviders =>
    automationProviders({
      doc,
      node,
      field: source,
      types,
      ...(context.sampleOf !== undefined && { sampleOf: context.sampleOf }),
    });

  /** The live sentence under a condition, or its static description. */
  const explainOf = (field: string, value: string): string | undefined => {
    const descriptionKey = CONDITION_DESCRIPTIONS[field];
    const staticDescription =
      descriptionKey === undefined ? undefined : t(descriptionKey);
    if (value.trim() === '') return staticDescription;
    switch (field) {
      case 'when': {
        const condition = conditionText(value, conditionContext);
        return condition === null
          ? t('editor.explain.whenRaw')
          : t('editor.explain.when', { condition });
      }
      case 'repeatUntil': {
        const condition = conditionText(value, conditionContext);
        return condition === null
          ? staticDescription
          : t('editor.explain.repeatUntil', {
              condition,
              max: node.maxRepeats ?? 5,
            });
      }
      case 'forEach': {
        const list = describeList(value);
        return list === null
          ? staticDescription
          : t('editor.explain.forEach', {
              list: renderOperand(list, conditionContext),
            });
      }
      default:
        return staticDescription;
    }
  };

  const renderField = (fieldName: string) => {
    const value = readNodeField(node, fieldName);
    const editor = fieldEditor(node, fieldName, value);
    const label = t(`editor.fields.${fieldName}`, { defaultValue: fieldName });
    const anchor = anchorOf(fieldName);
    const issueLines = issuesByField.get(fieldName);
    const reveal = revealOf(fieldName);
    const isControlFlow = (controlFlowFields as readonly string[]).includes(
      fieldName,
    );
    switch (editor.kind) {
      case 'code': {
        const text = typeof value === 'string' ? value : '';
        const marks = marksOf(fieldName, 'string');
        const description = isControlFlow
          ? explainOf(fieldName, text)
          : undefined;
        return (
          <CodeField
            key={fieldName}
            label={label}
            {...(description !== undefined && { description })}
            {...(required.has(fieldName) && { required: true })}
            editor={editor}
            value={text}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({
                [fieldName]: isControlFlow && next === '' ? undefined : next,
              });
            }}
            anchor={anchor}
            issues={issueLines}
            reveal={reveal}
            diagnostics={marks.diagnostics}
            diagnosticsFor={marks.diagnosticsFor}
            diagnosticsStatus={context.diagnosticsStatus}
            providers={providersOf(editor.source)}
          />
        );
      }
      case 'json': {
        const marks = marksOf(fieldName, 'json');
        const field = (
          <JsonCodeField
            key={fieldName}
            label={label}
            {...(fieldName === 'input' && {
              description: t('editor.fields.inputDescription'),
            })}
            value={value}
            expect={editor.expect}
            templates={editor.source !== null}
            {...(editor.source !== null && {
              templateScanner: engineTemplateScan,
              providers: providersOf(editor.source),
            })}
            onCommit={(next) => {
              onChange({ [fieldName]: next });
            }}
            anchor={anchor}
            issueReveal={reveal}
            issues={issueLines}
            diagnostics={marks.diagnostics}
            diagnosticsFor={marks.diagnosticsFor}
            diagnosticsStatus={context.diagnosticsStatus}
            readOnly={readOnly}
            minRows={editor.minRows}
            maxRows={editor.maxRows}
          />
        );
        // Unused optional JSON (staged files, output schema) is a disclosure
        // so an empty box does not sit between the prompt and the model.
        if (
          (fieldName === 'files' || fieldName === 'outputSchema') &&
          value === undefined
        ) {
          return (
            <CollapsibleDetails
              key={fieldName}
              summary={label}
              variant="compact"
              defaultOpen={(issueLines?.length ?? 0) > 0}
            >
              <div className="mt-3">{field}</div>
            </CollapsibleDetails>
          );
        }
        return field;
      }
      case 'readonlyJson': {
        return (
          <ReadOnlyJsonField
            key={fieldName}
            label={label}
            value={value}
            anchor={anchor}
            reveal={reveal}
          />
        );
      }
      case 'model':
        // The models the organization serves, not a free box — the run
        // would refuse anything else, and only at the first live run.
        return (
          <LlmModelField
            key={fieldName}
            organizationId={organizationId}
            model={typeof value === 'string' ? value : ''}
            required={required.has(fieldName)}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ model: next });
            }}
          />
        );
      case 'maxRepeats':
        return (
          <MaxRepeatsField
            key={fieldName}
            value={typeof value === 'number' ? value : undefined}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ maxRepeats: next });
            }}
            anchor={anchor}
            issues={issueLines}
            reveal={reveal}
          />
        );
      case 'elseOf':
        return (
          <ElseOfField
            key={fieldName}
            node={node}
            doc={doc}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ elseOf: next });
            }}
            anchor={anchor}
            issues={issueLines}
            reveal={reveal}
          />
        );
      case 'onError':
        return (
          <OnErrorField
            key={fieldName}
            value={node.onError}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ onError: next });
            }}
            anchor={anchor}
            issues={issueLines}
            reveal={reveal}
          />
        );
      default:
        return (
          <TextField
            key={fieldName}
            label={label}
            required={required.has(fieldName)}
            value={typeof value === 'string' ? value : ''}
            anchor={anchor}
            issues={issueLines}
            reveal={reveal}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ [fieldName]: next });
            }}
          />
        );
    }
  };

  const fields = (
    <>
      {declaredFields.map(renderField)}

      {isAgent && (
        <AgentNodeFields
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          node={node}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}

      {renderField('input')}

      <CollapsibleDetails
        ref={controlFlowRef}
        summary={t('editor.controlFlowTitle')}
        // Set control flow is part of what the node does, so it opens on it
        // — as it does on a problem in it; unused, it stays folded under the
        // fields that matter.
        defaultOpen={hasControlFlow}
      >
        <div className="mt-3 flex flex-col gap-3">
          {controlFlowFields.map(renderField)}
        </div>
      </CollapsibleDetails>
    </>
  );

  const shapeStatus = context.shapeStatus;
  const connector =
    nodeType?.connector === undefined
      ? undefined
      : connectorName(nodeType.connector, catalog, locale);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionHeader
          as="h3"
          size="sm"
          title={
            <span
              ref={headingRef}
              id={headingId}
              tabIndex={-1}
              className="focus-visible:ring-ring block truncate rounded-sm outline-none focus-visible:ring-2"
            >
              {nodeTitle(node.id)}
            </span>
          }
          description={
            nodeType === undefined
              ? t('editor.unknownType', { type: node.type })
              : catalogLabel(node, faceContext)
          }
          {...(onDeselect !== undefined && {
            action: (
              <IconButton
                icon={X}
                size="sm"
                aria-label={tCommon('aria.close')}
                onClick={onDeselect}
              />
            ),
          })}
        />
        <NodeIdRow nodeId={node.id} />
      </div>

      {catalogUnavailable && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          description={t('editor.catalogUnavailable')}
        />
      )}

      {nodeIssues.length > 0 && (
        <Card padding="none">
          {/* Under the inspector's own h3, at the size of the rows it heads. */}
          <h4
            id={nodeIssuesTitleId}
            className="text-foreground px-3 pt-3 text-sm font-medium"
          >
            {t('problems.nodeTitle')}
          </h4>
          <IssueList
            issues={nodeIssues}
            density="compact"
            aria-labelledby={nodeIssuesTitleId}
          />
        </Card>
      )}

      <NodeFlowSummary
        node={node}
        flow={context.flow}
        {...(context.analysis !== null &&
          Object.hasOwn(context.analysis.nodes, node.id) && {
            failureReasons: context.analysis.nodes[node.id]?.failureReasons,
          })}
        readerCount={readers.length}
        marks={face.markers.flatMap((marker) =>
          marker.id === 'unpinnedModel' ? [] : [marker.label],
        )}
      />

      <InspectorTabs
        tab={tab}
        onTabChange={setTab}
        fields={fields}
        {...(shapeStatus !== 'off' && {
          shape: (
            <NodeShapePanel
              node={node}
              types={types}
              status={shapeStatus}
              words={{
                ...(connector !== undefined && { connector }),
                type: coreTypeWord(node.type, t),
              }}
              readers={readers}
              readByOutput={readByOutput}
              {...(context.onSelect !== undefined && {
                onSelect: context.onSelect,
              })}
              endId={END_ID}
            />
          ),
        })}
        {...(runView !== undefined && {
          run: (
            <RunStepDetail
              runView={runView}
              {...(runRecord !== undefined && { record: runRecord })}
            />
          ),
        })}
      />
    </div>
  );
}

/** A value of a field this build has no control for, shown as JSON: it
 *  stays in the document as it is. */
function ReadOnlyJsonField({
  label,
  value,
  anchor,
  reveal,
}: {
  label: string;
  value: unknown;
  anchor: string | null;
  reveal: () => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <CodeEditor
        id={id}
        value={jsonFieldText(value)}
        language="json"
        readOnly
        minRows={1}
        maxRows={8}
        issueAnchor={anchor}
        issueReveal={reveal}
      />
    </Field>
  );
}

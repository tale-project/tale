'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Field } from '@tale/ui/field';
import type { FieldIssue } from '@tale/ui/field-issue-messages';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { useIssueFocusTarget } from '@tale/ui/issue-focus';
import { IssueList } from '@tale/ui/issue-list';
import { SectionHeader } from '@tale/ui/section-header';
import { Textarea } from '@tale/ui/textarea';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { ptr } from '@/lib/engine/core/syntax/pointer';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import type { NodeTypeSummary } from '../hooks/backend';
import { useDeselectOnEscape } from '../hooks/use-deselect-on-escape';
import {
  CONTROL_FLOW_FIELDS,
  declaredInspectorFields,
} from '../lib/inspector-fields';
import { fieldIssueMessage, type AutomationIssueView } from '../lib/issues';
import type { NodeRunView } from '../lib/run-view';
import { AgentNodeFields } from './agent-node-fields';
import { LlmModelField } from './llm-model-field';
import { RunStepDetail } from './run-step-detail';

/**
 * How one declared field is edited. The SET of fields comes from the engine
 * registry — `allowedFields` on the node type — so a connector that ships a new
 * action needs no change here; only the control a known field name deserves is
 * decided locally, and an unrecognised field falls back to a single-line box
 * rather than being hidden.
 */
const FIELD_CONTROL: Record<string, 'text' | 'multiline' | 'json'> = {
  input: 'json',
  outputSchema: 'json',
  code: 'multiline',
  prompt: 'multiline',
  system: 'multiline',
  model: 'text',
  harness: 'text',
  skills: 'json',
  connectors: 'json',
  tools: 'json',
  secrets: 'json',
  files: 'json',
  automation: 'text',
  credential: 'text',
};

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

function stringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn('Node field is not serialisable as JSON', error);
    return '';
  }
}

/** Where a field's problems are, and what they say under its control. */
interface FieldIssueProps {
  /** The field's pointer in the document (`/nodes/2/prompt`): "go to" a
   * problem there, or inside it, lands on this control. */
  anchor?: string | null;
  issues?: readonly FieldIssue[];
}

/** A text field, with its label really tied to its control. */
function TextField({
  label,
  description,
  required,
  multiline,
  monospace,
  rows,
  value,
  readOnly,
  onChange,
  anchor = null,
  issues,
}: {
  label: string;
  description?: string;
  required?: boolean;
  multiline?: boolean;
  monospace?: boolean;
  rows?: number;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
} & FieldIssueProps) {
  const id = useId();
  const controlRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // The box shows the field's string as it is stored, so a problem's range
  // inside it selects exactly the offending text.
  useIssueFocusTarget(anchor, controlRef);
  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(required !== undefined && { required })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
    >
      {multiline === true ? (
        <Textarea
          ref={controlRef}
          id={id}
          rows={rows ?? 3}
          readOnly={readOnly}
          className={monospace === true ? 'font-mono text-xs' : undefined}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <Input
          ref={controlRef}
          id={id}
          readOnly={readOnly}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** A JSON-valued field: parsed on every keystroke so the error appears where
 * it was made, and the node is only patched once the text parses. */
function JsonField({
  label,
  description,
  title,
  rows = 3,
  value,
  readOnly,
  onCommit,
  anchor = null,
  issues,
}: {
  label: string;
  description?: string;
  /** Hover hint — used when the help would otherwise eat a paragraph of height. */
  title?: string;
  rows?: number;
  value: unknown;
  readOnly: boolean;
  onCommit: (parsed: unknown) => void;
} & FieldIssueProps) {
  const { t } = useT('automations');
  const id = useId();
  const controlRef = useRef<HTMLTextAreaElement>(null);
  // The box shows the value re-serialised as JSON, so offsets into a string
  // inside it do not apply: a problem there focuses the box as a whole.
  const focusTarget = useMemo(
    () => ({
      focus: () => {
        const box = controlRef.current;
        if (box === null) return;
        box.closest('details')?.setAttribute('open', '');
        box.focus({ preventScroll: true });
        box.scrollIntoView({ block: 'nearest' });
      },
    }),
    [],
  );
  useIssueFocusTarget(anchor, focusTarget);
  const [text, setText] = useState(() => stringify(value));
  const [error, setError] = useState<string | null>(null);

  // A different node (or a reloaded document) replaces the text outright — an
  // edit in progress belongs to the node it was typed into.
  useEffect(() => {
    setText(stringify(value));
    setError(null);
  }, [value]);

  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(error !== null && { error })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
    >
      <Textarea
        ref={controlRef}
        id={id}
        rows={rows}
        readOnly={readOnly}
        className="font-mono text-xs"
        value={text}
        {...(title !== undefined && { title })}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') {
            setError(null);
            onCommit(undefined);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(next);
            setError(null);
            onCommit(parsed);
          } catch {
            setError(t('editor.invalidJson'));
          }
        }}
      />
    </Field>
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
  nodeType,
  catalogUnavailable = false,
  runView,
  readOnly,
  onChange,
  organizationId,
  projectId,
  onDeselect,
  variant = 'card',
  issues,
  nodeIndex,
}: NodeInspectorProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const selectedNodeId = node.id;

  useDeselectOnEscape(true, onDeselect);

  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    section.scrollTop = 0;
    section.focus({ preventScroll: true });
  }, [selectedNodeId]);

  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn(
        'border-border flex h-full max-h-[70dvh] min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 outline-none lg:max-h-none',
        variant === 'card'
          ? 'bg-card rounded-lg border'
          : // Its one border faces the canvas: above the panel where the two
            // stack, beside it from `lg` up.
            'bg-background border-t lg:border-t-0 lg:border-l',
      )}
    >
      <NodeFields
        // Each node opens on its own fields: its disclosures start from its
        // own state, and no half-typed JSON follows the reader to the next.
        key={node.id}
        headingId={headingId}
        node={node}
        nodeType={nodeType}
        catalogUnavailable={catalogUnavailable}
        runView={runView}
        readOnly={readOnly}
        onChange={onChange}
        organizationId={organizationId}
        {...(projectId !== undefined && { projectId })}
        {...(onDeselect !== undefined && { onDeselect })}
        {...(issues !== undefined && { issues })}
        {...(nodeIndex !== undefined && { nodeIndex })}
      />
    </section>
  );
}

export interface NodeFieldsProps {
  headingId: string;
  node: NodeDef;
  nodeType: NodeTypeSummary | undefined;
  catalogUnavailable: boolean;
  runView: NodeRunView | undefined;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
  organizationId: string;
  projectId?: string;
  onDeselect?: () => void;
  /** The problems the editor's check found on this node. */
  issues?: readonly AutomationIssueView[];
  /** The node's position in the document — its problems' pointers name it. */
  nodeIndex?: number;
}

const NO_ISSUE_VIEWS: readonly AutomationIssueView[] = [];

/**
 * The node's own fields, with no outer chrome — `NodeInspector`'s `card` and
 * `panel` variants wrap this in a bordered section; the Editor tab's mobile
 * sheet (`AutomationEditor`) renders it directly inside a `ResponsiveDialog`
 * instead, since a sheet's chrome is the dialog's, not this component's.
 *
 * Problems the editor's check found show where they are fixed: under the
 * field's control, or — for a part of the node without a box of its own (a
 * model picker, an unknown field, the node as a whole) — in a list at the
 * top. Each control registers where "go to" a problem lands.
 */
export function NodeFields({
  headingId,
  node,
  nodeType,
  catalogUnavailable,
  runView,
  readOnly,
  onChange,
  organizationId,
  projectId,
  onDeselect,
  issues = NO_ISSUE_VIEWS,
  nodeIndex,
}: NodeFieldsProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const isAgent = node.type === 'agent';
  const isLlm = node.type === 'llm';
  const declaredFields = declaredInspectorFields(
    node,
    nodeType?.allowedFields ?? [],
  );
  const required = new Set(nodeType?.requiredFields ?? []);
  const issuesByField = useMemo(() => {
    const byField = new Map<string, FieldIssue[]>();
    for (const view of issues) {
      if (view.navigation.kind !== 'field') continue;
      const list = byField.get(view.navigation.field) ?? [];
      list.push({
        id: view.issue.id,
        severity: view.issue.level,
        message: fieldIssueMessage(view, t),
      });
      byField.set(view.navigation.field, list);
    }
    return byField;
  }, [issues, t]);
  const nodeIssues = useMemo(
    () =>
      issues.flatMap((view) =>
        view.navigation.kind === 'node' ? [view.item] : [],
      ),
    [issues],
  );
  const hasControlFlow = CONTROL_FLOW_FIELDS.some(
    (field) =>
      (node[field] ?? '') !== '' || (issuesByField.get(field)?.length ?? 0) > 0,
  );
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

  return (
    <div className="flex flex-col gap-3">
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
            {node.id}
          </span>
        }
        {...(nodeType === undefined && {
          description: t('editor.unknownType', { type: node.type }),
        })}
        action={
          <span className="flex items-center gap-1">
            <Badge
              variant="slate"
              {...(nodeType?.description !== undefined && {
                title: nodeType.description,
              })}
            >
              {node.type}
            </Badge>
            {onDeselect !== undefined && (
              <IconButton
                icon={X}
                size="sm"
                aria-label={tCommon('aria.close')}
                onClick={onDeselect}
              />
            )}
          </span>
        }
      />

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

      {declaredFields.map((fieldName) => {
        const control = FIELD_CONTROL[fieldName] ?? 'text';
        const label = t(`editor.fields.${fieldName}`, {
          defaultValue: fieldName,
        });
        if (control === 'json') {
          const value = readNodeField(node, fieldName);
          const field = (
            <JsonField
              key={fieldName}
              label={label}
              value={value}
              anchor={anchorOf(fieldName)}
              issues={issuesByField.get(fieldName)}
              readOnly={readOnly}
              onCommit={(parsed) => {
                onChange({
                  [fieldName]:
                    parsed !== null && typeof parsed === 'object'
                      ? parsed
                      : undefined,
                });
              }}
            />
          );
          // Unused optional JSON (staged files, output schema) is a disclosure
          // so an empty box does not sit between the prompt and the model.
          if (
            (fieldName === 'files' || fieldName === 'outputSchema') &&
            (value === undefined || value === '')
          ) {
            return (
              <CollapsibleDetails
                key={fieldName}
                summary={label}
                variant="compact"
              >
                <div className="mt-3">{field}</div>
              </CollapsibleDetails>
            );
          }
          return field;
        }
        const raw = readNodeField(node, fieldName);
        if (isLlm && fieldName === 'model') {
          // The models the organization serves, not a free box — the run
          // would refuse anything else, and only at the first live run.
          return (
            <LlmModelField
              key={fieldName}
              organizationId={organizationId}
              model={typeof raw === 'string' ? raw : ''}
              required={required.has(fieldName)}
              readOnly={readOnly}
              onChange={(next) => {
                onChange({ model: next });
              }}
            />
          );
        }
        return (
          <TextField
            key={fieldName}
            label={label}
            required={required.has(fieldName)}
            multiline={control === 'multiline'}
            monospace={fieldName === 'code'}
            rows={fieldName === 'code' ? 6 : 3}
            value={typeof raw === 'string' ? raw : ''}
            anchor={anchorOf(fieldName)}
            issues={issuesByField.get(fieldName)}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ [fieldName]: next });
            }}
          />
        );
      })}

      {isAgent && (
        <AgentNodeFields
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          node={node}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}

      <JsonField
        label={t('editor.fields.input')}
        title={t('editor.fields.inputDescription')}
        value={node.input}
        anchor={anchorOf('input')}
        issues={issuesByField.get('input')}
        readOnly={readOnly}
        onCommit={(parsed) => {
          onChange({
            input:
              parsed !== null && typeof parsed === 'object'
                ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an input mapping is a JSON object by the document grammar
                  (parsed as Record<string, unknown>)
                : undefined,
          });
        }}
      />

      <CollapsibleDetails
        summary={t('editor.controlFlowTitle')}
        // Set control flow is part of what the node does, so it opens on it
        // — as it does on a problem in it; unused, it stays folded under the
        // fields that matter.
        defaultOpen={hasControlFlow}
      >
        <div className="mt-3 flex flex-col gap-3">
          {CONTROL_FLOW_FIELDS.map((fieldName) => (
            <TextField
              key={fieldName}
              label={t(`editor.fields.${fieldName}`)}
              value={node[fieldName] ?? ''}
              anchor={anchorOf(fieldName)}
              issues={issuesByField.get(fieldName)}
              readOnly={readOnly}
              onChange={(next) => {
                onChange({ [fieldName]: next === '' ? undefined : next });
              }}
            />
          ))}
        </div>
      </CollapsibleDetails>

      {runView && (
        <div className="border-border border-t pt-4">
          <RunStepDetail runView={runView} heading={t('editor.runTitle')} />
        </div>
      )}
    </div>
  );
}

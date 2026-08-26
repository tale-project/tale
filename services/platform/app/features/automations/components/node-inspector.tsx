'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Field } from '@tale/ui/field';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { SectionHeader } from '@tale/ui/section-header';
import { Textarea } from '@tale/ui/textarea';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import type { NodeTypeSummary } from '../hooks/backend';
import { useDeselectOnEscape } from '../hooks/use-deselect-on-escape';
import { controlFlowBadges } from '../lib/graph';
import type { NodeRunView } from '../lib/run-view';
import { AGENT_EQUIPMENT_FIELDS, AgentNodeFields } from './agent-node-fields';
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

/** The control-flow fields every node type accepts, in reading order. */
const CONTROL_FLOW_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
] as const;

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
}) {
  const id = useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(required !== undefined && { required })}
    >
      {multiline === true ? (
        <Textarea
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
}: {
  label: string;
  description?: string;
  /** Hover hint — used when the help would otherwise eat a paragraph of height. */
  title?: string;
  rows?: number;
  value: unknown;
  readOnly: boolean;
  onCommit: (parsed: unknown) => void;
}) {
  const { t } = useT('automations');
  const id = useId();
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
    >
      <Textarea
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
  /** The region id the canvas's node buttons point at. */
  id: string;
  node: NodeDef | null;
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
  projectId?: Id<'projects'>;
  /**
   * What the panel shows when no node is selected — the automation's trigger,
   * project bindings, and description. Hidden (not unmounted) while a node is
   * selected so unsaved trigger/project edits survive a click on the canvas.
   * The run page omits this and keeps the empty prompt.
   */
  workflow?: ReactNode;
  /** Clears the canvas selection — Close, Escape, and click-again share this. */
  onDeselect?: () => void;
}

/**
 * The inspector beside the canvas.
 *
 * With no node selected it shows the automation (trigger, projects, the pack
 * description) when the page hands that in — Figma's "the file, until you
 * click a layer". Clicking a box swaps to that node's fields; clicking the
 * same box again, Close, Escape (when not typing), or the empty canvas returns
 * to the automation. Focus moves into this panel on select so Tab reaches the
 * fields next. The workflow slot stays mounted and hidden so unsaved trigger
 * edits are not dropped.
 * A recorded run omits the slot and the empty prompt asks the reader to pick
 * a node.
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
  workflow,
  onDeselect,
}: NodeInspectorProps) {
  const { t } = useT('automations');
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const showingWorkflow = node === null && workflow !== undefined;
  const showingEmpty = node === null && workflow === undefined;
  const selectedNodeId = node?.id;

  useDeselectOnEscape(selectedNodeId !== undefined, onDeselect);

  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    section.scrollTop = 0;
    if (selectedNodeId !== undefined) {
      section.focus({ preventScroll: true });
    }
  }, [selectedNodeId]);

  return (
    <section
      ref={sectionRef}
      id={id}
      tabIndex={-1}
      aria-labelledby={showingWorkflow ? undefined : headingId}
      aria-label={showingWorkflow ? t('editor.workflowTitle') : undefined}
      className="border-border bg-card flex h-full max-h-[70dvh] min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border p-4 outline-none lg:max-h-none"
    >
      {showingEmpty && (
        <SectionHeader
          as="h3"
          size="sm"
          title={<span id={headingId}>{t('editor.title')}</span>}
          description={t('editor.noSelection')}
        />
      )}

      {workflow !== undefined && (
        <div hidden={node !== null} className="flex flex-col gap-4">
          {workflow}
        </div>
      )}

      {node !== null && (
        <NodeFields
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
        />
      )}
    </section>
  );
}

function NodeFields({
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
}: {
  headingId: string;
  node: NodeDef;
  nodeType: NodeTypeSummary | undefined;
  catalogUnavailable: boolean;
  runView: NodeRunView | undefined;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
  organizationId: string;
  projectId?: Id<'projects'>;
  onDeselect?: () => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const badges = controlFlowBadges(node);
  const isAgent = node.type === 'agent';
  const declaredFields = (nodeType?.allowedFields ?? []).filter(
    (field) =>
      field !== 'input' && !(isAgent && AGENT_EQUIPMENT_FIELDS.includes(field)),
  );
  const required = new Set(nodeType?.requiredFields ?? []);
  const hasControlFlow = CONTROL_FLOW_FIELDS.some(
    (field) => (node[field] ?? '') !== '',
  );

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        as="h3"
        size="sm"
        title={
          <span id={headingId} className="block truncate">
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

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map((badge) => (
            <Badge key={badge.kind} variant="blue">
              {t(`canvas.controlFlow.${badge.kind}`, { value: badge.value })}
            </Badge>
          ))}
        </div>
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
        return (
          <TextField
            key={fieldName}
            label={label}
            required={required.has(fieldName)}
            multiline={control === 'multiline'}
            monospace={fieldName === 'code'}
            rows={fieldName === 'code' ? 6 : 3}
            value={typeof raw === 'string' ? raw : ''}
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
        {...(hasControlFlow ? { defaultOpen: true } : {})}
      >
        <div className="mt-3 flex flex-col gap-3">
          {CONTROL_FLOW_FIELDS.map((fieldName) => (
            <TextField
              key={fieldName}
              label={t(`editor.fields.${fieldName}`)}
              value={node[fieldName] ?? ''}
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

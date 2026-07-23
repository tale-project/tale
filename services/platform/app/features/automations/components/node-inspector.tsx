'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import type { NodeTypeSummary } from '../hooks/backend';
import type { ReviewNote } from '../lib/document';
import { controlFlowBadges } from '../lib/graph';
import type { NodeRunView } from '../lib/run-view';
import { EffectList } from './effect-list';
import { RunStatusBadge } from './run-status-badge';

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
  workflow: 'text',
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
          rows={rows ?? 4}
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
  value,
  readOnly,
  onCommit,
}: {
  label: string;
  description?: string;
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
        rows={6}
        readOnly={readOnly}
        className="font-mono text-xs"
        value={text}
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
  reviewNotes: readonly ReviewNote[];
  /** What the overlaid run did to this node, when one is shown. */
  runView?: NodeRunView | undefined;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
}

/**
 * The editor for the selected node.
 *
 * It edits the document, not a model of it: the id and type identify the node,
 * the control-flow fields are the engine's own declarative branching and
 * iteration, and the remaining fields are exactly the ones the node type
 * declares. When a run is overlaid the same panel shows what that run did here
 * — its resolved input, its output, and every effect it performed — so the
 * author never has to hold the run and the definition in two places at once.
 */
export function NodeInspector({
  id,
  node,
  nodeType,
  catalogUnavailable = false,
  reviewNotes,
  runView,
  readOnly,
  onChange,
}: NodeInspectorProps) {
  const { t } = useT('automations');
  const headingId = useId();

  if (!node) {
    return (
      <section
        id={id}
        aria-labelledby={headingId}
        className="border-border bg-card rounded-lg border p-4"
      >
        <h3 id={headingId} className="text-sm font-semibold">
          {t('editor.title')}
        </h3>
        <Text as="p" variant="muted" className="mt-2 text-sm">
          {t('editor.noSelection')}
        </Text>
      </section>
    );
  }

  const badges = controlFlowBadges(node);
  const declaredFields = (nodeType?.allowedFields ?? []).filter(
    (field) => field !== 'input',
  );
  const required = new Set(nodeType?.requiredFields ?? []);

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="truncate text-sm font-semibold">
            {node.id}
          </h3>
          <Text as="p" variant="muted" className="text-xs">
            {nodeType?.description ??
              t('editor.unknownType', { type: node.type })}
          </Text>
        </div>
        <Badge variant="slate">{node.type}</Badge>
      </div>

      {catalogUnavailable && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          description={t('editor.catalogUnavailable')}
        />
      )}

      {reviewNotes.length > 0 && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          description={
            <>
              <p className="text-foreground font-medium">
                {t('review.nodeTitle')}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {reviewNotes.map((note) => (
                  <li key={note.reason}>{note.reason}</li>
                ))}
              </ul>
            </>
          }
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

      <JsonField
        label={t('editor.fields.input')}
        description={t('editor.fields.inputDescription')}
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

      {declaredFields.map((fieldName) => {
        const control = FIELD_CONTROL[fieldName] ?? 'text';
        const label = t(`editor.fields.${fieldName}`, {
          defaultValue: fieldName,
        });
        if (control === 'json') {
          return (
            <JsonField
              key={fieldName}
              label={label}
              value={readNodeField(node, fieldName)}
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
        }
        const raw = readNodeField(node, fieldName);
        return (
          <TextField
            key={fieldName}
            label={label}
            required={required.has(fieldName)}
            multiline={control === 'multiline'}
            monospace={fieldName === 'code'}
            rows={fieldName === 'code' ? 8 : 4}
            value={typeof raw === 'string' ? raw : ''}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ [fieldName]: next });
            }}
          />
        );
      })}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">
          {t('editor.controlFlowTitle')}
        </legend>
        {CONTROL_FLOW_FIELDS.map((fieldName) => (
          <TextField
            key={fieldName}
            label={t(`editor.fields.${fieldName}`)}
            description={t(`editor.fields.${fieldName}Description`)}
            value={node[fieldName] ?? ''}
            readOnly={readOnly}
            onChange={(next) => {
              onChange({ [fieldName]: next === '' ? undefined : next });
            }}
          />
        ))}
      </fieldset>

      {runView && (
        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{t('editor.runTitle')}</h4>
            <RunStatusBadge status={runView.status} />
          </div>
          {runView.error !== undefined && (
            <Alert variant="destructive" description={runView.error} />
          )}
          {runView.note !== undefined && (
            <Text as="p" variant="muted" className="text-xs">
              {runView.note}
            </Text>
          )}
          {runView.input !== undefined && (
            <div>
              <Text as="p" className="mb-1 text-xs font-medium">
                {t('editor.resolvedInput')}
              </Text>
              <JsonViewer data={runView.input} collapsed={1} />
            </div>
          )}
          {runView.output !== undefined && (
            <div>
              <Text as="p" className="mb-1 text-xs font-medium">
                {t('editor.output')}
              </Text>
              <JsonViewer data={runView.output} collapsed={1} />
            </div>
          )}
          <EffectList
            effects={runView.effects}
            emptyMessage={t('runs.effects.noneForNode')}
          />
        </div>
      )}
    </section>
  );
}

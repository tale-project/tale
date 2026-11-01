'use client';

import { Button } from '@tale/ui/button';
import type { CodeEditorDiagnosticsStatus } from '@tale/ui/code-editor';
import { Field } from '@tale/ui/field';
import type { FieldIssue } from '@tale/ui/field-issue-messages';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { useIssueFocusTarget } from '@tale/ui/issue-focus';
import { schemaKindLabel } from '@tale/ui/schema-tree';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Textarea } from '@tale/ui/textarea';
import { Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, type ReactNode } from 'react';

import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import {
  isExpectedNodeState,
  readTestForm,
  withDescription,
  withEffect,
  withFailure,
  withInput,
  withMock,
  withMustFail,
  withName,
  withNodeState,
  withOutput,
  type EffectInputMode,
  type EffectRow,
  type OutputMode,
} from '../../lib/automation-tests/test-form';
import { fieldDiagnostics } from '../../lib/code-diagnostics';
import { missingRequiredFields, placeholderFor } from '../../lib/fixed-input';
import { fieldIssueMessage, type AutomationIssueView } from '../../lib/issues';
import { nodeTitle } from '../../lib/node-face';
import { runInputProviders } from '../../lib/run-input-completion';
import {
  JsonCodeField,
  jsonFieldText,
  type JsonExpect,
} from '../json-code-field';
import { TestDataNotice } from './test-data-notice';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOutputMode(value: string): value is OutputMode {
  return value === 'equals' || value === 'includes' || value === 'none';
}

function isInputMode(value: string): value is EffectInputMode {
  return value === 'none' || value === 'equals' || value === 'includes';
}

/** The value at `tokens` under `root`, as the check saw it. */
function valueAt(root: unknown, tokens: readonly string[]): unknown {
  let at: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(at)) at = at[Number(token)];
    else if (isRecord(at)) at = at[token];
    else return undefined;
  }
  return at;
}

export interface TestSetupFormProps {
  index: number;
  /** The test as the draft holds it. */
  test: unknown;
  /** The same test as the check last saw it: its problems' places are in it. */
  settledTest: unknown;
  /** The automation the test runs: its nodes and run input. */
  doc: Automation;
  /** The check's problems in this test. */
  issues: readonly AutomationIssueView[];
  diagnosticsStatus: CodeEditorDiagnosticsStatus;
  readOnly: boolean;
  onChange: (next: Record<string, unknown>) => void;
  /** A node's output in the run laid over the canvas, to simulate it with. */
  lastRunOutputOf?: (nodeId: string) => unknown;
  /** The output the test's latest run returned, to expect it. */
  lastResultOutput?: unknown;
  /** An action as the canvas names its node type. */
  effectLabel: (connector: string) => string;
}

/**
 * A test's Setup as a form: its name and description, the run's input,
 * what it simulates — a node's output, a node's failure — and what it
 * expects of the run: the output (equal, or including what it lists), the
 * state of some nodes, actions that must or must not happen, or a run that
 * fails. Each control writes the field it shows into the raw test, so keys
 * the form has no control for stay as written; each registers its place, so
 * "go to" a problem in the test lands on it.
 */
export function TestSetupForm({
  index,
  test,
  settledTest,
  doc,
  issues,
  diagnosticsStatus,
  readOnly,
  onChange,
  lastRunOutputOf,
  lastResultOutput,
  effectLabel,
}: TestSetupFormProps) {
  const { t } = useT('automations');
  const { t: tSchema } = useT('schemaTree');
  const { locale } = useLocale();
  const raw = isRecord(test) ? test : {};
  const values = useMemo(() => readTestForm(test), [test]);
  const base = `/tests/${index}`;
  const nodeIds = doc.nodes.map((node) => node.id);
  const forEachNodes = new Set(
    doc.nodes.flatMap((node) => (node.forEach === undefined ? [] : [node.id])),
  );
  const nodeOptions = (taken: ReadonlySet<string>) =>
    // Transforms last: a test checks your code, so it rarely stands in for it.
    [...doc.nodes]
      .toSorted(
        (a, b) =>
          Number(a.type === 'transform') - Number(b.type === 'transform'),
      )
      .filter((node) => !taken.has(node.id))
      .map((node) => ({ value: node.id, label: nodeTitle(node.id) }));

  /** The problems at `pointer` or inside it, one line each. */
  const linesAt = (pointer: string): FieldIssue[] =>
    issues
      .filter(({ issue }) => {
        const at = issue.at?.pointer ?? '';
        return at === pointer || at.startsWith(`${pointer}/`);
      })
      .map((view) => ({
        id: view.issue.id,
        severity: view.issue.level,
        message: fieldIssueMessage(view, t),
      }));

  /** The same problems as one sentence, for a control with one error line. */
  const messageAt = (pointer: string): string | undefined => {
    const lines = issues
      .filter(({ issue }) => {
        const at = issue.at?.pointer ?? '';
        return at === pointer || at.startsWith(`${pointer}/`);
      })
      .map((view) => fieldIssueMessage(view, t));
    return lines.length === 0 ? undefined : lines.join(' ');
  };

  /** A JSON field of the test at `pointer`, with the check's marks. */
  const jsonField = (args: {
    pointer: string;
    label: string;
    description?: string;
    value: unknown;
    expect: JsonExpect;
    onCommit: (next: unknown) => void;
    actions?: ReactNode;
    providers?: ReturnType<typeof runInputProviders>;
  }) => {
    const tokens = args.pointer.slice(base.length).split('/').filter(Boolean);
    const settledText = jsonFieldText(valueAt(settledTest, tokens));
    const views = issues.filter(({ issue }) => {
      const at = issue.at?.pointer ?? '';
      return at === args.pointer || at.startsWith(`${args.pointer}/`);
    });
    const at = (shown: string) =>
      views.length === 0
        ? []
        : fieldDiagnostics({
            views,
            fieldPointer: args.pointer,
            text: shown,
            kind: 'json',
            t,
          });
    return (
      // Its place is its key, for the rows a list of these makes.
      <div key={args.pointer} className="flex flex-col gap-1.5">
        <JsonCodeField
          label={args.label}
          {...(args.description !== undefined && {
            description: args.description,
          })}
          value={args.value}
          expect={args.expect}
          onCommit={args.onCommit}
          anchor={args.pointer}
          issues={linesAt(args.pointer)}
          diagnostics={at(settledText)}
          diagnosticsFor={settledText}
          diagnosticsAt={at}
          diagnosticsStatus={diagnosticsStatus}
          {...(args.providers !== undefined && { providers: args.providers })}
          readOnly={readOnly}
          minRows={2}
          maxRows={10}
        />
        {args.actions}
      </div>
    );
  };

  const inputProviders = useMemo(
    () =>
      runInputProviders(doc.inputs, (field) =>
        schemaKindLabel(tSchema, field, locale),
      ),
    [doc.inputs, tSchema, locale],
  );
  const missing = missingRequiredFields(
    isRecord(doc.inputs) ? doc.inputs : undefined,
    isRecord(values.input) ? values.input : {},
  );

  const mocked = new Set(values.mocks.map(([node]) => node));
  const failing = new Set(values.failures.map(([node]) => node));
  // A node takes one stand-in: none for a node the test picks a scenario
  // for, which the form leaves as written.
  const standingIn = new Set([
    ...mocked,
    ...failing,
    ...(isRecord(raw.scenarios) ? Object.keys(raw.scenarios) : []),
  ]);
  const expectedNodes = new Set(values.nodes.map(([node]) => node));
  const effectTypes = [
    ...new Set(
      doc.nodes.flatMap((node) =>
        node.type === 'transform' || node.type === 'subautomation'
          ? []
          : [node.type],
      ),
    ),
  ];
  const mustFail = values.failure !== null;

  return (
    <div className="flex flex-col gap-4">
      <TestDataNotice />
      <TestTextField
        label={t('tests.fields.name')}
        required
        value={values.name}
        anchor={`${base}/name`}
        issues={linesAt(`${base}/name`)}
        readOnly={readOnly}
        onChange={(name) => onChange(withName(raw, name))}
      />
      <TestDescriptionField
        label={t('tests.fields.description')}
        value={values.description}
        anchor={`${base}/description`}
        issues={linesAt(`${base}/description`)}
        readOnly={readOnly}
        onChange={(description) => onChange(withDescription(raw, description))}
      />
      {jsonField({
        pointer: `${base}/input`,
        label: t('tests.fields.input'),
        description: t('tests.fields.inputHint'),
        value: values.input,
        expect: 'any',
        onCommit: (input) => onChange(withInput(raw, input)),
        providers: inputProviders,
        ...(!readOnly &&
          missing.length > 0 && {
            actions: (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto self-start px-0"
                onClick={() =>
                  onChange(
                    withInput(raw, {
                      ...(isRecord(values.input) ? values.input : {}),
                      ...Object.fromEntries(
                        missing.map((field) => [
                          field.name,
                          placeholderFor(field.type),
                        ]),
                      ),
                    }),
                  )
                }
              >
                {t('trigger.fixedInput.fillMissing', { count: missing.length })}
              </Button>
            ),
          }),
      })}

      <FormSection
        title={t('tests.fields.mocks')}
        description={t('tests.fields.mocksHint')}
      >
        {values.mocks.map(([node, output]) =>
          jsonField({
            pointer: `${base}/mocks/${node}`,
            label: nodeTitle(node),
            ...(forEachNodes.has(node) && {
              description: t('tests.fields.mocksList'),
            }),
            value: output,
            expect: 'any',
            onCommit: (next) =>
              onChange(withMock(raw, node, next === undefined ? null : next)),
            actions: (
              <div className="flex flex-wrap items-center gap-2">
                {!readOnly && lastRunOutputOf?.(node) !== undefined && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() =>
                      onChange(withMock(raw, node, lastRunOutputOf(node)))
                    }
                  >
                    {t('tests.fields.useLastRun')}
                  </Button>
                )}
                {!readOnly && (
                  <RemoveButton
                    label={t('tests.fields.remove', { node: nodeTitle(node) })}
                    onRemove={() => onChange(withMock(raw, node, undefined))}
                  />
                )}
              </div>
            ),
          }),
        )}
        {!readOnly && (
          <AddPicker
            label={t('tests.fields.mocksAdd')}
            options={nodeOptions(standingIn)}
            onPick={(node) =>
              onChange(withMock(raw, node, forEachNodes.has(node) ? [] : {}))
            }
          />
        )}
      </FormSection>

      <FormSection
        title={t('tests.fields.failures')}
        description={t('tests.fields.failuresHint')}
      >
        {values.failures.map(([node, message]) => (
          <div key={node} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TestTextField
                label={t('tests.fields.failureMessage', {
                  node: nodeTitle(node),
                })}
                value={message}
                anchor={`${base}/failures/${node}`}
                issues={linesAt(`${base}/failures/${node}`)}
                readOnly={readOnly}
                onChange={(next) => onChange(withFailure(raw, node, next))}
              />
            </div>
            {!readOnly && (
              <RemoveButton
                label={t('tests.fields.remove', { node: nodeTitle(node) })}
                onRemove={() => onChange(withFailure(raw, node, undefined))}
              />
            )}
          </div>
        ))}
        {!readOnly && (
          <AddPicker
            label={t('tests.fields.failuresAdd')}
            options={nodeOptions(standingIn)}
            onPick={(node) =>
              onChange(withFailure(raw, node, t('tests.fields.failureDefault')))
            }
          />
        )}
      </FormSection>

      <FormSection title={t('tests.fields.expect')}>
        <SegmentedControl
          aria-label={t('tests.fields.outputModeLabel')}
          value={mustFail ? 'none' : values.output.mode}
          disabled={readOnly || mustFail}
          onValueChange={(mode) => {
            if (isOutputMode(mode)) {
              onChange(withOutput(raw, mode, values.output.value));
            }
          }}
          options={[
            { value: 'equals', label: t('tests.fields.outputMode.equals') },
            {
              value: 'includes',
              label: t('tests.fields.outputMode.includes'),
            },
            { value: 'none', label: t('tests.fields.outputMode.none') },
          ]}
        />
        {mustFail ? (
          <p className="text-muted-foreground text-xs">
            {t('tests.fields.outputWhileFailing')}
          </p>
        ) : (
          values.output.mode !== 'none' &&
          jsonField({
            pointer: `${base}/expect/${values.output.mode === 'equals' ? 'output' : 'outputIncludes'}`,
            label: t('tests.fields.expectOutput'),
            value: values.output.value,
            expect: 'any',
            onCommit: (next) =>
              onChange(withOutput(raw, values.output.mode, next)),
            ...(!readOnly &&
              lastResultOutput !== undefined && {
                actions: (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto self-start px-0"
                    onClick={() =>
                      onChange(
                        withOutput(raw, values.output.mode, lastResultOutput),
                      )
                    }
                  >
                    {t('tests.fields.useLastResult')}
                  </Button>
                ),
              }),
          })
        )}

        <h5 className="text-foreground pt-2 text-sm font-medium">
          {t('tests.fields.expectNodes')}
        </h5>
        {values.nodes.map(([node, state]) => (
          <div key={node} className="flex items-end gap-2">
            <NodeStateSelect
              label={nodeTitle(node)}
              value={state}
              anchor={`${base}/expect/nodes/${node}`}
              errorMessage={messageAt(`${base}/expect/nodes/${node}`)}
              readOnly={readOnly}
              onChange={(next) => onChange(withNodeState(raw, node, next))}
            />
            {!readOnly && (
              <RemoveButton
                label={t('tests.fields.remove', { node: nodeTitle(node) })}
                onRemove={() => onChange(withNodeState(raw, node, undefined))}
              />
            )}
          </div>
        ))}
        {!readOnly && (
          <AddPicker
            label={t('tests.fields.nodesAdd')}
            options={nodeOptions(expectedNodes)}
            onPick={(node) => onChange(withNodeState(raw, node, 'ran'))}
          />
        )}

        <h5 className="text-foreground pt-2 text-sm font-medium">
          {t('tests.fields.expectActions')}
        </h5>
        {values.effects.map((row, at) => (
          <EffectFields
            // An action's place is its key: its rows have no ids.
            key={at}
            row={row}
            pointer={`${base}/expect/effects/${at}`}
            types={effectTypes}
            nodes={nodeIds}
            effectLabel={effectLabel}
            jsonField={jsonField}
            messageAt={messageAt}
            readOnly={readOnly}
            onChange={(next) => onChange(withEffect(raw, at, next))}
          />
        ))}
        {!readOnly && effectTypes.length > 0 && (
          <AddPicker
            label={t('tests.fields.actionsAdd')}
            options={effectTypes.map((type) => ({
              value: type,
              label: effectLabel(type),
            }))}
            onPick={(connector) =>
              onChange(
                withEffect(raw, values.effects.length, {
                  connector,
                  absent: false,
                  inputMode: 'none',
                }),
              )
            }
          />
        )}

        <FailureFields
          failure={values.failure}
          pointer={`${base}/expect/failure`}
          nodes={nodeIds}
          linesAt={linesAt}
          readOnly={readOnly}
          onChange={(next) => onChange(withMustFail(raw, next))}
        />
      </FormSection>
    </div>
  );
}

/** A titled group of the form. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h4 id={titleId} className="text-foreground text-sm font-medium">
        {title}
      </h4>
      {description !== undefined && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      {children}
    </section>
  );
}

/** A one-line text field that "go to" can land on. */
function TestTextField({
  label,
  required,
  value,
  anchor,
  issues,
  readOnly,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  anchor: string;
  issues: readonly FieldIssue[];
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useIssueFocusTarget(anchor, ref);
  return (
    <Field
      label={label}
      htmlFor={id}
      {...(required === true && { required })}
      {...(issues.length > 0 && { issues })}
    >
      <Input
        ref={ref}
        id={id}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** The test's description: a few lines for people. */
function TestDescriptionField({
  label,
  value,
  anchor,
  issues,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  anchor: string;
  issues: readonly FieldIssue[];
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useIssueFocusTarget(anchor, ref);
  return (
    <Field label={label} htmlFor={id} {...(issues.length > 0 && { issues })}>
      <Textarea
        ref={ref}
        id={id}
        rows={2}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A picker that adds a row: choosing an option adds it, and the picker
 * reads its label again. */
function AddPicker({
  label,
  options,
  onPick,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Select
      aria-label={label}
      placeholder={label}
      value=""
      options={options}
      className="w-fit"
      onValueChange={(value) => {
        // Radix fires a spurious '' on unmount — never act on it.
        if (value !== '') onPick(value);
      }}
    />
  );
}

/** Removes a row of the form. */
function RemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <IconButton
      icon={Trash2}
      size="sm"
      variant="ghost"
      aria-label={label}
      onClick={onRemove}
    />
  );
}

/** What must happen to one node. */
function NodeStateSelect({
  label,
  value,
  anchor,
  errorMessage,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  anchor: string;
  errorMessage: string | undefined;
  readOnly: boolean;
  onChange: (next: 'ran' | 'skipped' | 'failed') => void;
}) {
  const { t } = useT('automations');
  const ref = useRef<HTMLButtonElement>(null);
  useIssueFocusTarget(anchor, ref);
  return (
    <div className="min-w-0 flex-1">
      <Select
        ref={ref}
        label={label}
        value={value}
        disabled={readOnly}
        {...(errorMessage !== undefined && { errorMessage })}
        options={[
          { value: 'ran', label: t('tests.nodeState.ran') },
          { value: 'skipped', label: t('tests.nodeState.skipped') },
          { value: 'failed', label: t('tests.nodeState.failed') },
        ]}
        onValueChange={(next) => {
          if (isExpectedNodeState(next)) onChange(next);
        }}
      />
    </div>
  );
}

/** One expected action: which, from which node, whether it must or must
 * not happen, and what its input must hold. */
function EffectFields({
  row,
  pointer,
  types,
  nodes,
  effectLabel,
  jsonField,
  messageAt,
  readOnly,
  onChange,
}: {
  row: EffectRow;
  pointer: string;
  types: readonly string[];
  nodes: readonly string[];
  effectLabel: (connector: string) => string;
  jsonField: (args: {
    pointer: string;
    label: string;
    value: unknown;
    expect: JsonExpect;
    onCommit: (next: unknown) => void;
  }) => ReactNode;
  messageAt: (pointer: string) => string | undefined;
  readOnly: boolean;
  onChange: (next: EffectRow | undefined) => void;
}) {
  const { t } = useT('automations');
  const actionRef = useRef<HTMLButtonElement>(null);
  useIssueFocusTarget(pointer, actionRef);
  const allTypes = types.includes(row.connector)
    ? types
    : [row.connector, ...types];
  const error = messageAt(`${pointer}/connector`);
  return (
    <div className="border-border flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            ref={actionRef}
            label={t('tests.fields.action.label')}
            value={row.connector}
            disabled={readOnly}
            {...(error !== undefined && { errorMessage: error })}
            options={allTypes.map((type) => ({
              value: type,
              label: effectLabel(type),
            }))}
            onValueChange={(connector) => {
              if (connector !== '') onChange({ ...row, connector });
            }}
          />
        </div>
        {!readOnly && (
          <RemoveButton
            label={t('tests.fields.removeAction', {
              action: effectLabel(row.connector),
            })}
            onRemove={() => onChange(undefined)}
          />
        )}
      </div>
      <Select
        label={t('tests.fields.action.node')}
        value={row.node ?? ''}
        disabled={readOnly}
        placeholder={t('tests.fields.action.anyNode')}
        options={[
          { value: '__any', label: t('tests.fields.action.anyNode') },
          ...nodes.map((node) => ({ value: node, label: nodeTitle(node) })),
        ]}
        onValueChange={(node) => {
          if (node === '') return;
          const { node: _dropped, ...rest } = row;
          onChange(node === '__any' ? rest : { ...rest, node });
        }}
      />
      <SegmentedControl
        aria-label={t('tests.fields.action.happensLabel')}
        value={row.absent ? 'absent' : 'happens'}
        disabled={readOnly}
        onValueChange={(value) =>
          onChange({ ...row, absent: value === 'absent' })
        }
        options={[
          { value: 'happens', label: t('tests.fields.action.happens') },
          { value: 'absent', label: t('tests.fields.action.absent') },
        ]}
      />
      {!row.absent && (
        <>
          <SegmentedControl
            aria-label={t('tests.fields.action.inputLabel')}
            value={row.inputMode}
            disabled={readOnly}
            onValueChange={(mode) => {
              if (isInputMode(mode)) onChange({ ...row, inputMode: mode });
            }}
            options={[
              { value: 'none', label: t('tests.fields.action.inputMode.none') },
              {
                value: 'equals',
                label: t('tests.fields.action.inputMode.equals'),
              },
              {
                value: 'includes',
                label: t('tests.fields.action.inputMode.includes'),
              },
            ]}
          />
          {row.inputMode !== 'none' &&
            jsonField({
              pointer: `${pointer}/${row.inputMode === 'equals' ? 'input' : 'inputIncludes'}`,
              label: t('tests.fields.action.input'),
              value: row.input,
              expect: 'any',
              onCommit: (input) => onChange({ ...row, input }),
            })}
        </>
      )}
    </div>
  );
}

/** "The run must fail", and where and how when it is on. */
function FailureFields({
  failure,
  pointer,
  nodes,
  linesAt,
  readOnly,
  onChange,
}: {
  failure: { node?: string; message?: string } | null;
  pointer: string;
  nodes: readonly string[];
  linesAt: (pointer: string) => FieldIssue[];
  readOnly: boolean;
  onChange: (next: { node?: string; message?: string } | null) => void;
}) {
  const { t } = useT('automations');
  const switchRef = useRef<HTMLButtonElement>(null);
  useIssueFocusTarget(pointer, switchRef);
  const issues = linesAt(pointer);
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Switch
        ref={switchRef}
        label={t('tests.fields.mustFail')}
        description={t('tests.fields.mustFailHint')}
        checked={failure !== null}
        disabled={readOnly}
        onCheckedChange={(on) => onChange(on ? {} : null)}
      />
      {failure !== null && (
        <>
          <Select
            label={t('tests.fields.failAt')}
            value={failure.node ?? ''}
            disabled={readOnly}
            placeholder={t('tests.fields.action.anyNode')}
            options={[
              { value: '__any', label: t('tests.fields.action.anyNode') },
              ...nodes.map((node) => ({
                value: node,
                label: nodeTitle(node),
              })),
            ]}
            onValueChange={(node) => {
              if (node === '') return;
              const { node: _dropped, ...rest } = failure;
              onChange(node === '__any' ? rest : { ...rest, node });
            }}
          />
          <TestTextField
            label={t('tests.fields.failMessage')}
            value={failure.message ?? ''}
            anchor={`${pointer}/message`}
            issues={issues}
            readOnly={readOnly}
            onChange={(message) => onChange({ ...failure, message })}
          />
        </>
      )}
    </div>
  );
}

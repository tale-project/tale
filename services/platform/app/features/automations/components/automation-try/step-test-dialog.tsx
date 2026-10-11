'use client';

import { Alert } from '@tale/ui/alert';
import { CodeEditor } from '@tale/ui/code-editor';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { useId, useMemo, useState } from 'react';

import type { Json, RunBench } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { parseJsonText } from '../../hooks/use-json-input-draft';
import type {
  StepTestNeeds,
  StepTestPins,
} from '../../lib/automation-tests/step-test';
import { nodeTitle } from '../../lib/node-face';

/** Where a read node's data starts from: the run on the canvas, the data
 * this node was last tested with, or nothing yet. */
export type PinSource = 'run' | 'remembered' | 'none';

export interface StepTestDialogProps {
  needs: StepTestNeeds;
  initial: {
    pins: Readonly<Record<string, { value: unknown; from: PinSource }>>;
    input: unknown;
    /** Counted from 1, as the field shows it. */
    item: number;
  };
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Runs the node alone: `kept` is what to start from next time. */
  onRun: (input: unknown, bench: RunBench, kept: StepTestPins) => void;
}

const text = (value: unknown): string =>
  JSON.stringify(value === undefined ? null : value, null, 2);

/** One read node's data as JSON, with where it came from. */
function PinField({
  node,
  from,
  value,
  invalid,
  onChange,
}: {
  node: string;
  from: PinSource;
  value: string;
  invalid: boolean;
  onChange: (next: string) => void;
}) {
  const { t } = useT('automations');
  const id = useId();
  return (
    <Field
      label={nodeTitle(node)}
      htmlFor={id}
      description={
        from === 'run'
          ? t('stepTest.fromRun')
          : from === 'remembered'
            ? t('stepTest.fromRemembered')
            : t('stepTest.missing', { node: nodeTitle(node) })
      }
      error={invalid ? t('detail.runInput.invalidJson') : undefined}
    >
      <CodeEditor
        id={id}
        language="json"
        value={value}
        onChange={onChange}
        minRows={3}
        maxRows={10}
        describeDiagnostics={false}
      />
    </Field>
  );
}

/**
 * Testing one node alone, as the draft has it: the data each node it reads
 * stands in with — from the run on the canvas, or as written here — the
 * run's input when it reads that, and which item when it runs once per
 * item. Nothing of it is kept but the data, for testing it again.
 */
export function StepTestDialog({
  needs,
  initial,
  pending = false,
  error,
  onClose,
  onRun,
}: StepTestDialogProps) {
  const { t } = useT('automations');
  const inputId = useId();
  const [pinTexts, setPinTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      needs.reads.map((node) => [node, text(initial.pins[node]?.value)]),
    ),
  );
  const [inputText, setInputText] = useState(() => text(initial.input ?? {}));
  const [item, setItem] = useState(String(initial.item));
  const parsed = useMemo(() => {
    const pins: Record<string, Json> = {};
    const invalid = new Set<string>();
    for (const node of needs.reads) {
      const read = parseJsonText(pinTexts[node] ?? 'null');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse output is Json by construction
      if (read.ok) pins[node] = read.value as Json;
      else invalid.add(node);
    }
    const input = needs.readsInput ? parseJsonText(inputText) : undefined;
    const itemNumber = Number(item);
    const itemValid =
      !needs.perItem || (Number.isInteger(itemNumber) && itemNumber >= 1);
    return {
      pins,
      invalid,
      input,
      itemNumber,
      valid:
        invalid.size === 0 && (input === undefined || input.ok) && itemValid,
    };
  }, [needs, pinTexts, inputText, item]);

  const run = (): void => {
    if (!parsed.valid) return;
    const input =
      parsed.input !== undefined && parsed.input.ok
        ? parsed.input.value
        : initial.input;
    onRun(
      input,
      {
        only: needs.node.id,
        mocks: parsed.pins,
        ...(needs.perItem && { item: parsed.itemNumber - 1 }),
      },
      { pins: parsed.pins, input, item: parsed.itemNumber },
    );
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={onClose}
      title={t('stepTest.title', { node: nodeTitle(needs.node.id) })}
      description={t('stepTest.description')}
      confirmText={t('stepTest.run')}
      disableConfirm={!parsed.valid}
      isLoading={pending}
      onConfirm={run}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert variant="destructive" description={error} />}
        {needs.reads.length > 0 && (
          <div className="flex flex-col gap-3">
            <Text as="h3" className="text-foreground text-sm font-medium">
              {t('stepTest.usesData')}
            </Text>
            {needs.reads.map((node) => (
              <PinField
                key={node}
                node={node}
                from={initial.pins[node]?.from ?? 'none'}
                value={pinTexts[node] ?? 'null'}
                invalid={parsed.invalid.has(node)}
                onChange={(next) =>
                  setPinTexts((previous) => ({ ...previous, [node]: next }))
                }
              />
            ))}
          </div>
        )}
        {needs.readsInput && (
          <Field
            label={t('detail.runInput.label')}
            htmlFor={inputId}
            error={
              parsed.input !== undefined && !parsed.input.ok
                ? t('detail.runInput.invalidJson')
                : undefined
            }
          >
            <CodeEditor
              id={inputId}
              language="json"
              value={inputText}
              onChange={setInputText}
              minRows={3}
              maxRows={10}
              describeDiagnostics={false}
            />
          </Field>
        )}
        {needs.perItem && (
          <Input
            type="number"
            min={1}
            step={1}
            label={t('stepTest.item')}
            description={t('stepTest.itemHelp')}
            value={item}
            onChange={(event) => setItem(event.target.value)}
          />
        )}
      </div>
    </ConfirmDialog>
  );
}

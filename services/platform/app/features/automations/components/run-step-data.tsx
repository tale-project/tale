'use client';

import { DataDiff } from '@tale/ui/data-diff';
import { DataView, type DataViewMode } from '@tale/ui/data-view';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import type { NodeRunDetail } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import {
  type ConditionTextContext,
  renderOperand,
} from '../lib/condition-text';
import { valueWords } from '../lib/condition-values';
import { nodeTitle } from '../lib/node-face';

type Read = NodeRunDetail['reads'][number];

/** A read in words, the way a condition names what it reads: "issues of
 *  Open issues", "amount of the run input". */
function readWords(read: Read, ctx: ConditionTextContext): string {
  return renderOperand(
    read.from.kind === 'input'
      ? { kind: 'ref', root: 'input', path: read.refPath, range: [0, 0] }
      : {
          kind: 'ref',
          root: 'node',
          nodeId: read.from.nodeId,
          path: read.refPath,
          range: [0, 0],
        },
    ctx,
  );
}

/** What a read read: its source and path. */
function readKey(read: Read): string {
  return JSON.stringify([
    read.from.kind === 'node' ? read.from.nodeId : '',
    read.refPath,
  ]);
}

/** The reads of a step, each source and path once, in the order it read
 *  them. */
function distinctReads(reads: readonly Read[]): Read[] {
  const seen = new Set<string>();
  return reads.filter((read) => {
    const key = readKey(read);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One stored value: the value itself, or its summary in words when the
 *  run kept no more of it, with whether parts of it were cut or hidden. */
/** Values above this size download rather than only copy. */
const DOWNLOAD_BYTES = 8 * 1024;

function StoredValue({
  label,
  value,
  ctx,
  mode,
  onModeChange,
  showModeSwitch,
  fileName,
}: {
  label: string;
  value: NonNullable<NodeRunDetail['input']>;
  ctx: ConditionTextContext;
  mode: DataViewMode;
  onModeChange: (mode: DataViewMode) => void;
  showModeSwitch: boolean;
  fileName: string;
}) {
  const { t } = useT('automationRuns');
  const cut = (value.elided?.length ?? 0) > 0 || (value.elidedTotal ?? 0) > 0;
  const hidden =
    (value.redacted?.length ?? 0) > 0 || (value.redactedTotal ?? 0) > 0;
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium">{label}</h4>
      <DataView
        value={value.value}
        recorded={{
          elided: value.elided ?? [],
          redacted: (value.redacted ?? []).map((entry) => entry.pointer),
          bytes: value.bytes,
        }}
        aria-label={label}
        mode={mode}
        onModeChange={onModeChange}
        showModeSwitch={showModeSwitch}
        toolbar={{
          copy: true,
          download: value.bytes > DOWNLOAD_BYTES ? { fileName } : false,
          fullScreen: { title: label },
        }}
        // Past the run's budget for values only the summary was kept.
        empty={
          <Text as="p" className="text-sm">
            {valueWords(value.summary, ctx)}
          </Text>
        }
        density="compact"
      />
      {cut && (
        <Text as="p" variant="muted" className="text-xs">
          {t('data.elided')}
        </Text>
      )}
      {hidden && (
        <Text as="p" variant="muted" className="text-xs">
          {t('data.redacted')}
        </Text>
      )}
    </section>
  );
}

/**
 * What one step of a run worked with, as the run's record keeps it: what it
 * read from the run input and from other steps, each in words with the
 * value it read; the input it received; and what it returned.
 */
export function RunStepData({
  detail,
  fileStem = 'step',
}: {
  detail: NodeRunDetail;
  /** What a downloaded value's file is named after: the automation, the
   * run and the step. */
  fileStem?: string;
}) {
  const { t } = useT('automationRuns');
  // One Values / Shape switch for every value the step shows.
  const [mode, setMode] = useState<DataViewMode>('values');
  const { t: tAutomations } = useT('automations');
  const { locale } = useLocale();
  const ctx: ConditionTextContext = {
    t: tAutomations,
    locale,
    nodeLabel: nodeTitle,
  };
  const reads = distinctReads(detail.reads);
  if (
    reads.length === 0 &&
    detail.call === undefined &&
    detail.input === undefined &&
    detail.output === undefined
  ) {
    return (
      <Text as="p" variant="muted" className="text-sm">
        {t('data.notReached')}
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {reads.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium">{t('data.reads')}</h4>
          <ul className="flex flex-col gap-0.5 text-sm">
            {reads.map((read) => {
              const operand = readWords(read, ctx);
              return (
                // One template reads one path per item: what it read is
                // the row, not where it read it.
                <li key={readKey(read)}>
                  {read.value === undefined
                    ? operand
                    : t('data.readValue', {
                        operand,
                        value: valueWords(read.value, ctx),
                      })}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {detail.call !== undefined && (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium">{t('data.call.title')}</h4>
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <code className="font-mono text-xs">{detail.call.type}</code>
            <span>{t(`data.call.status.${detail.call.status}`)}</span>
            {detail.call.attempt > 1 && (
              <Text as="span" variant="muted" className="text-xs">
                {t('data.call.attempt', { n: detail.call.attempt })}
              </Text>
            )}
          </p>
          {detail.call.resolution !== undefined && (
            <Text as="p" variant="muted" className="text-xs">
              {t(`data.call.resolution.${detail.call.resolution}`)}
            </Text>
          )}
        </section>
      )}
      {detail.input !== undefined && (
        <StoredValue
          label={t('data.received')}
          value={detail.input}
          ctx={ctx}
          mode={mode}
          onModeChange={setMode}
          showModeSwitch
          fileName={`${fileStem}-input.json`}
        />
      )}
      {detail.output !== undefined && (
        <StoredValue
          label={t('data.returned')}
          value={detail.output}
          ctx={ctx}
          mode={mode}
          onModeChange={setMode}
          showModeSwitch={detail.input === undefined}
          fileName={`${fileStem}-output.json`}
        />
      )}
      {/* What the step changed: shown where the record says its input and
          output compare (both objects, or both lists). */}
      {detail.change !== undefined &&
        detail.input?.value !== undefined &&
        detail.output?.value !== undefined && (
          <section className="flex flex-col gap-1">
            <h4 className="text-xs font-medium">{t('data.changes')}</h4>
            <DataDiff
              before={detail.input.value}
              after={detail.output.value}
              mode={mode}
              labels={{
                before: t('data.received'),
                after: t('data.returned'),
              }}
              aria-label={t('data.changes')}
            />
          </section>
        )}
    </div>
  );
}

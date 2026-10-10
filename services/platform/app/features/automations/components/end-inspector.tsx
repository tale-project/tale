'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { JsonViewer } from '@tale/ui/json-viewer';
import { useId, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { automationProviders } from '../lib/code-providers';
import type { DocumentPatch } from '../lib/draft-document';
import { endOutcomes } from '../lib/flow-graph';
import { END_ID } from '../lib/flow-ids';
import type { AutomationIssueView } from '../lib/issues';
import { nodeTitle } from '../lib/node-face';
import { failureReasonWords } from '../lib/paths';
import {
  DocumentInspectorHeader,
  DocumentJsonField,
  InspectorRows,
} from './document-inspector-parts';
import {
  InspectorFrame,
  InspectorTabs,
  useInspectorTab,
  type InspectorContext,
  type InspectorTab,
} from './node-inspector';
import { ShapeBlock, ShapeStatusLine } from './node-shape-panel';

const NO_ISSUES: readonly AutomationIssueView[] = [];

export interface EndFieldsProps {
  headingId: string;
  readOnly: boolean;
  onChange: (patch: DocumentPatch) => void;
  /** The problems "go to" brings to End: the output's. */
  issues?: readonly AutomationIssueView[];
  context: InspectorContext;
  /** The output of the run laid over the canvas, when one is. */
  run?: { output: unknown };
  onDeselect?: () => void;
  defaultTab?: InspectorTab;
}

/**
 * End's inspector, without a frame (the phone's sheet has its own): how a
 * run ends — with the nodes whose failure stops it, each a way to that
 * node — and what a successful run returns: the output to edit, with
 * completion and types in its templates, the shape the check worked out,
 * and the output of the run on the canvas.
 */
export function EndFields({
  headingId,
  readOnly,
  onChange,
  issues = NO_ISSUES,
  context,
  run,
  onDeselect,
  defaultTab,
}: EndFieldsProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const outcomesTitleId = useId();
  const haltsTitleId = useId();
  const [tab, setTab] = useInspectorTab(
    context.shapeStatus !== 'off',
    run !== undefined,
    defaultTab,
  );
  const { doc, flow, analysis, types, sampleOf, onSelect } = context;
  const halts = useMemo(() => {
    const reasonsOf = new Map(
      (analysis?.paths.halts ?? []).map((halt) => [halt.nodeId, halt.reasons]),
    );
    const either = new Intl.ListFormat(locale, { type: 'disjunction' });
    return (flow?.halts ?? []).map(({ nodeId }) => {
      const words = (reasonsOf.get(nodeId) ?? []).flatMap((reason) => {
        const text = failureReasonWords(reason, t);
        return text === null ? [] : [text];
      });
      const node = nodeTitle(nodeId);
      return {
        nodeId,
        label:
          words.length === 0
            ? node
            : t('paths.halts.row', { node, reasons: either.format(words) }),
      };
    });
  }, [analysis, flow, locale, t]);
  const providers = useMemo(
    () =>
      automationProviders({
        doc,
        field: 'output',
        types,
        ...(sampleOf !== undefined && { sampleOf }),
      }),
    [doc, types, sampleOf],
  );
  const shapeStatus = context.shapeStatus;

  return (
    <div className="flex flex-col gap-3">
      <DocumentInspectorHeader
        headingId={headingId}
        title={t('editor.end.title')}
        description={t('editor.end.description')}
        {...(onDeselect !== undefined && { onDeselect })}
      />

      <section
        aria-labelledby={outcomesTitleId}
        className="flex flex-col gap-2"
      >
        <h4
          id={outcomesTitleId}
          className="text-foreground text-sm font-medium"
        >
          {t('editor.end.outcomes')}
        </h4>
        <InspectorRows
          rows={endOutcomes(t, halts.length)}
          labelledBy={outcomesTitleId}
        >
          {(row) =>
            row.id === 'failed' && halts.length > 0 ? (
              <div className="flex flex-col gap-1 pl-5.5">
                <p id={haltsTitleId} className="text-muted-foreground text-xs">
                  {t('paths.halts.title')}
                </p>
                <ul
                  aria-labelledby={haltsTitleId}
                  className="flex flex-wrap gap-1"
                >
                  {halts.map((halt) => (
                    <li key={halt.nodeId} className="min-w-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-auto min-h-7 max-w-full text-left whitespace-normal"
                        disabled={onSelect === undefined}
                        onClick={() => onSelect?.(halt.nodeId)}
                      >
                        {halt.label}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          }
        </InspectorRows>
      </section>

      <InspectorTabs
        tab={tab}
        onTabChange={setTab}
        fields={
          <DocumentJsonField
            field="output"
            label={t('editor.fields.output')}
            description={t('editor.end.outputDescription')}
            expect="any"
            value={doc.output}
            issues={issues}
            context={context}
            readOnly={readOnly}
            onCommit={(next) => {
              onChange({ output: next });
            }}
            reveal={() => setTab('fields')}
            providers={providers}
          />
        }
        {...(shapeStatus !== 'off' && {
          shape: (
            <div className="flex flex-col gap-4">
              <ShapeStatusLine status={shapeStatus} />
              {types !== null && (
                <ShapeBlock
                  title={t('editor.shape.returns')}
                  shape={types.output}
                />
              )}
            </div>
          ),
        })}
        {...(run !== undefined && {
          run: (
            <div className="flex flex-col gap-1">
              <h4 className="text-foreground text-sm font-medium">
                {t('runs.outputTitle')}
              </h4>
              <JsonViewer data={run.output} collapsed={1} />
            </div>
          ),
        })}
      />
    </div>
  );
}

/** End's inspector beside the canvas: `EndFields` in the inspector's
 *  frame. */
export function EndInspector({
  id,
  variant = 'card',
  onDeselect,
  ...rest
}: Omit<EndFieldsProps, 'headingId'> & {
  /** The region id End's box on the canvas points at. */
  id: string;
  variant?: 'card' | 'panel';
}) {
  const headingId = useId();
  return (
    <InspectorFrame
      id={id}
      labelledBy={headingId}
      focusKey={END_ID}
      variant={variant}
      {...(onDeselect !== undefined && { onDeselect })}
    >
      <EndFields
        headingId={headingId}
        {...(onDeselect !== undefined && { onDeselect })}
        {...rest}
      />
    </InspectorFrame>
  );
}

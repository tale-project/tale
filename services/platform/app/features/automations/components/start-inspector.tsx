'use client';

import { buttonVariants } from '@tale/ui/button';
import type { FlowRow } from '@tale/ui/flow/types';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SchemaTree } from '@tale/ui/schema-tree';
import { Link } from '@tanstack/react-router';
import { Settings2 } from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import type { DocumentPatch } from '../lib/draft-document';
import { START_ID } from '../lib/flow-ids';
import type { AutomationIssueView } from '../lib/issues';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface StartFieldsProps {
  headingId: string;
  /** What starts a run, as Start's rows on the canvas say it. */
  triggers: readonly FlowRow[];
  /** The automation's General tab, where its trigger is changed. */
  generalHref?: string;
  readOnly: boolean;
  onChange: (patch: DocumentPatch) => void;
  /** The problems "go to" brings to Start: the run input's schema. */
  issues?: readonly AutomationIssueView[];
  context: InspectorContext;
  /** The input of the run laid over the canvas, when one is. */
  run?: { input: unknown };
  onDeselect?: () => void;
  defaultTab?: InspectorTab;
}

/**
 * Start's inspector, without a frame (the phone's sheet has its own): what
 * starts a run, with the way to change it, and what every run receives —
 * the fields of the run input as a tree and its JSON Schema to edit, the
 * shape the check worked out, and the input of the run on the canvas.
 */
export function StartFields({
  headingId,
  triggers,
  generalHref,
  readOnly,
  onChange,
  issues = NO_ISSUES,
  context,
  run,
  onDeselect,
  defaultTab,
}: StartFieldsProps) {
  const { t } = useT('automations');
  const triggerTitleId = useId();
  const inputsTitleId = useId();
  const [tab, setTab] = useInspectorTab(
    context.shapeStatus !== 'off',
    run !== undefined,
    defaultTab,
  );
  const inputs = context.doc.inputs;
  const shapeStatus = context.shapeStatus;
  const { types } = context;

  const fields = (
    <>
      <section aria-labelledby={inputsTitleId} className="flex flex-col gap-1">
        <h4 id={inputsTitleId} className="text-foreground text-sm font-medium">
          {t('editor.start.inputs')}
        </h4>
        {isRecord(inputs) ? (
          <SchemaTree
            // An author's JSON Schema: the tree reads the keywords it knows
            // and ignores the rest.
            schema={inputs}
            density="comfortable"
            aria-labelledby={inputsTitleId}
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            {t('canvas.start.anyInput')}
          </p>
        )}
      </section>
      <DocumentJsonField
        field="inputs"
        label={t('detail.runInput.schema')}
        description={t('editor.start.inputsDescription')}
        expect="object"
        value={inputs}
        issues={issues}
        context={context}
        readOnly={readOnly}
        onCommit={(next) => {
          onChange({ inputs: next });
        }}
        reveal={() => setTab('fields')}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <DocumentInspectorHeader
        headingId={headingId}
        title={t('editor.start.title')}
        description={t('editor.start.description')}
        {...(onDeselect !== undefined && { onDeselect })}
      />

      <section aria-labelledby={triggerTitleId} className="flex flex-col gap-2">
        <h4 id={triggerTitleId} className="text-foreground text-sm font-medium">
          {t('editor.start.trigger')}
        </h4>
        <InspectorRows rows={triggers} labelledBy={triggerTitleId} />
        {generalHref !== undefined && (
          <Link
            to={generalHref}
            className={buttonVariants({
              variant: 'secondary',
              size: 'sm',
              className: 'self-start',
            })}
          >
            <Settings2 className="mr-2 size-4" aria-hidden="true" />
            {t('editor.start.editTrigger')}
          </Link>
        )}
      </section>

      <InspectorTabs
        tab={tab}
        onTabChange={setTab}
        fields={fields}
        {...(shapeStatus !== 'off' && {
          shape: (
            <div className="flex flex-col gap-4">
              <ShapeStatusLine status={shapeStatus} />
              {types !== null && (
                <ShapeBlock
                  title={t('editor.shape.receives')}
                  shape={types.inputs}
                />
              )}
            </div>
          ),
        })}
        {...(run !== undefined && {
          run: (
            <div className="flex flex-col gap-1">
              <h4 className="text-foreground text-sm font-medium">
                {t('runs.inputTitle')}
              </h4>
              <JsonViewer data={run.input} collapsed={1} />
            </div>
          ),
        })}
      />
    </div>
  );
}

/** Start's inspector beside the canvas: `StartFields` in the inspector's
 *  frame. */
export function StartInspector({
  id,
  variant = 'card',
  onDeselect,
  ...rest
}: Omit<StartFieldsProps, 'headingId'> & {
  /** The region id Start's box on the canvas points at. */
  id: string;
  variant?: 'card' | 'panel';
}) {
  const headingId = useId();
  return (
    <InspectorFrame
      id={id}
      labelledBy={headingId}
      focusKey={START_ID}
      variant={variant}
      {...(onDeselect !== undefined && { onDeselect })}
    >
      <StartFields
        headingId={headingId}
        {...(onDeselect !== undefined && { onDeselect })}
        {...rest}
      />
    </InspectorFrame>
  );
}

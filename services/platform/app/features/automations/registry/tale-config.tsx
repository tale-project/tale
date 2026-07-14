'use client';

/**
 * The Tale Puck registry — `@tale/ui` components + the connected (data-bound)
 * blocks, composed by an automation's view (Puck Data) and rendered headlessly with
 * `<Render config={taleConfig} data={view} />`. This replaced the old
 * configurable-view system (view parts bound to the closed data-source +
 * action-kind vocabularies): adding a component is now one registry entry
 * (eventually codegen'd over the whole library), not a bespoke panel. The
 * render-kinds vocabulary is NOT replaced by this — it still renders live
 * workflow-run steps (`ui.render`), which an automation reuses via the embedded run.
 *
 * Phase 1 registers a representative presentational batch + the connected
 * blocks that the issue-desk demo needs; `fields` are minimal (the data is
 * authored as Puck JSON for now — the `<Puck>` visual editor is Phase 2).
 */
import {
  type Config,
  type DefaultComponentProps,
  type Fields,
  type PuckComponent,
} from '@measured/puck';
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@tale/ui/card';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import type { ReactElement } from 'react';

import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';

import { PackMarkdown } from '../components/pack-markdown';
import { useBlockWhenGate } from '../hooks/use-block-when-gate';
import { BindingStates, BlockFrame } from './block-frame';
import {
  agentChatBlock,
  type AgentChatBlockProps,
} from './connected/agent-chat';
import { AgentList, type AgentListProps } from './connected/agent-list';
import { boardBlock, type BoardProps } from './connected/board';
import {
  chartCardBlock,
  type ChartCardBlockProps,
} from './connected/chart-card';
import { Collection, type CollectionProps } from './connected/collection';
import {
  detailPanelBlock,
  type DetailPanelProps,
} from './connected/detail-panel';
import {
  ExternalList,
  type ExternalListProps,
} from './connected/external-list';
import { formBlock, type FormBlockProps } from './connected/form';
import { ReviewQueue, type ReviewQueueProps } from './connected/review';
import { RunList, type RunListProps } from './connected/run-list';
import { statGridBlock, type StatGridProps } from './connected/stat-grid';
import { WorkflowDag, type WorkflowDagProps } from './connected/workflow-dag';

type TextVariant =
  | 'body'
  | 'body-sm'
  | 'muted'
  | 'caption'
  | 'label'
  | 'code'
  | 'error'
  | 'success';
type BadgeVariant =
  | 'outline'
  | 'destructive'
  | 'orange'
  | 'yellow'
  | 'blue'
  | 'green'
  | 'slate';
type AlertVariant = 'default' | 'destructive' | 'warning' | 'info';

/** Pack-authored per-locale overrides for presentational string props. */
type BlockI18n = Record<string, Record<string, string>> | undefined;

interface TaleComponents {
  Heading: {
    text: string;
    level: 1 | 2 | 3 | 4 | 5 | 6;
    i18n?: BlockI18n;
  };
  Text: {
    text: string;
    variant: TextVariant;
    i18n?: BlockI18n;
    when?: string;
    whenQuery?: { path: string; args?: unknown };
  };
  Badge: { text: string; variant: BadgeVariant; i18n?: BlockI18n };
  Alert: {
    variant: AlertVariant;
    title: string;
    description: string;
    i18n?: BlockI18n;
    when?: string;
    whenQuery?: { path: string; args?: unknown };
  };
  Card: {
    title: string;
    description: string;
    body: string;
    i18n?: BlockI18n;
  };
  // Connected blocks: the data (query/columns/actions) is authored as Puck JSON,
  // so the editor fields are optional here (the `<Puck>` editor is Phase 2).
  Collection: Partial<CollectionProps>;
  ReviewQueue: Partial<ReviewQueueProps>;
  ExternalList: Partial<ExternalListProps>;
  AgentList: Partial<AgentListProps>;
  WorkflowDag: Partial<WorkflowDagProps>;
  RunList: Partial<RunListProps>;
  StatGrid: Partial<StatGridProps>;
  ChartCard: Partial<ChartCardBlockProps>;
  DetailPanel: Partial<DetailPanelProps>;
  Form: Partial<FormBlockProps>;
  Board: Partial<BoardProps>;
  AgentChat: Partial<AgentChatBlockProps>;
}

const opts = <T extends string | number>(values: readonly T[]) =>
  values.map((v) => ({ label: String(v), value: v }));

/** Resolve a pack-authored presentational string against the active locale. */
function useLocalizedProp(
  base: string | undefined,
  i18n: BlockI18n,
  prop: string,
): string | undefined {
  const { locale } = useLocale();
  return resolveLocalizedProp(base, i18n, prop, locale);
}

/** Apply optional `when`/`whenQuery` — hide, show needs-project, or render. */
function WhenGated({
  when,
  whenQuery,
  children,
}: {
  when?: string;
  whenQuery?: { path: string; args?: unknown };
  children: ReactElement;
}): ReactElement | null {
  const gate = useBlockWhenGate(when, whenQuery);
  if (gate.decision === 'pending' || gate.decision === 'hide') return null;
  if (gate.decision === 'needsConfig') {
    if (gate.needsProject) {
      return <BindingStates needsProject>{null}</BindingStates>;
    }
    return null;
  }
  return children;
}

function LocalizedHeading({
  text,
  level,
  i18n,
}: TaleComponents['Heading']): ReactElement {
  const resolved = useLocalizedProp(text, i18n, 'text') ?? text;
  return <Heading level={level}>{resolved}</Heading>;
}

function LocalizedText({
  text,
  variant,
  i18n,
  when,
  whenQuery,
}: TaleComponents['Text']): ReactElement | null {
  const resolved = useLocalizedProp(text, i18n, 'text') ?? text;
  return (
    <WhenGated when={when} whenQuery={whenQuery}>
      <PackMarkdown text={resolved} variant={variant} />
    </WhenGated>
  );
}

function LocalizedBadge({
  text,
  variant,
  i18n,
}: TaleComponents['Badge']): ReactElement {
  const resolved = useLocalizedProp(text, i18n, 'text') ?? text;
  return <Badge variant={variant}>{resolved}</Badge>;
}

function LocalizedAlert({
  variant,
  title,
  description,
  i18n,
  when,
  whenQuery,
}: TaleComponents['Alert']): ReactElement | null {
  const resolvedTitle = useLocalizedProp(title, i18n, 'title') ?? title;
  const resolvedDescription =
    useLocalizedProp(description, i18n, 'description') ?? description;
  return (
    <WhenGated when={when} whenQuery={whenQuery}>
      <Alert
        variant={variant}
        title={resolvedTitle}
        description={
          // No `variant`: inherit the alert palette's tinted description
          // colour instead of forcing the standalone text presets.
          resolvedDescription !== undefined ? (
            <PackMarkdown text={resolvedDescription} />
          ) : undefined
        }
      />
    </WhenGated>
  );
}

function LocalizedCard({
  title,
  description,
  body,
  i18n,
}: TaleComponents['Card']): ReactElement {
  const resolvedTitle = useLocalizedProp(title, i18n, 'title');
  const resolvedDescription = useLocalizedProp(
    description,
    i18n,
    'description',
  );
  const resolvedBody = useLocalizedProp(body, i18n, 'body') ?? body;
  return (
    <Card>
      {(resolvedTitle || resolvedDescription) && (
        <CardHeader className="pb-3">
          {resolvedTitle ? <CardTitle>{resolvedTitle}</CardTitle> : null}
          {resolvedDescription ? (
            // CardDescription is a <p> — markdown paragraphs can't nest inside
            // it, so render the markdown div with its exact styling instead.
            <PackMarkdown
              text={resolvedDescription}
              className="text-fg-muted text-sm"
            />
          ) : null}
        </CardHeader>
      )}
      <CardContent>
        <PackMarkdown text={resolvedBody} variant="body" />
      </CardContent>
    </Card>
  );
}

/**
 * The registration chokepoint for CONNECTED (data-bound) blocks: wraps the
 * block's render in a per-block error boundary (the platform's
 * `ErrorBoundaryBase` + compact display, the DataTable pattern), so one
 * crashing block degrades to an in-flow error card instead of taking down the
 * whole view. The FALLBACK keeps the block's `BlockFrame` (with its literal
 * `title` prop) around the error display, so a failed block stays
 * identifiable in place — a Convex reactive read that errors (e.g. the raw
 * `usePaginatedQuery` rethrowing a server error into render) lands here, and
 * without the frame the whole card silently became an anonymous error panel.
 * Chrome/framing is NOT added around the happy path — existing blocks render
 * their own `Section` internally, and new blocks compose
 * `BlockFrame`/`BindingStates` (`registry/block-frame.tsx`) — so there is
 * exactly one frame per block.
 */
export function registerConnectedBlock<Props extends DefaultComponentProps>(
  name: string,
  block: { fields?: Fields<Props>; render: PuckComponent<Props> },
): { fields?: Fields<Props>; render: PuckComponent<Props> } {
  const Render = block.render;
  const render: PuckComponent<Props> = (props) => {
    const title = typeof props.title === 'string' ? props.title : undefined;
    return (
      <ErrorBoundaryBase
        onError={(error) => {
          console.error(`[automation-registry] block "${name}" crashed`, error);
        }}
        fallback={({ error, reset }) => (
          <BlockFrame title={title}>
            <ErrorDisplayCompact error={error} reset={reset} />
          </BlockFrame>
        )}
      >
        <Render {...props} />
      </ErrorBoundaryBase>
    );
  };
  return { ...block, render };
}

export const taleConfig: Config<TaleComponents> = {
  // Stack authored blocks with the same gap the rest of the product uses
  // between cards. Puck's headless `<Render>` passes a single DropZone as
  // `children` (not the blocks themselves), so a plain flex gap on the root
  // never reaches the cards — `[&>div]:contents` dissolves that wrapper so
  // Text / Alert / Form / Collection become the flex children.
  root: {
    // Accept Puck's full root props (id/puck/editMode/children) — a narrow
    // `{ children }` annotation is a weak type and fails assignability to
    // `PuckComponent<any>`.
    render: (props) => (
      <div className="flex flex-col gap-4 [&>div]:contents">
        {props.children}
      </div>
    ),
  },
  components: {
    Heading: {
      fields: {
        text: { type: 'text' },
        level: { type: 'select', options: opts([1, 2, 3, 4, 5, 6] as const) },
      },
      defaultProps: { text: 'Heading', level: 2 },
      // Pack-authored `i18n.<locale>.text` overrides the English literal.
      render: (props) => <LocalizedHeading {...props} />,
    },
    Text: {
      fields: {
        text: { type: 'textarea' },
        variant: {
          type: 'select',
          options: opts([
            'body',
            'body-sm',
            'muted',
            'caption',
            'label',
            'code',
            'error',
            'success',
          ] as const),
        },
      },
      defaultProps: { text: 'Text', variant: 'body' },
      render: (props) => <LocalizedText {...props} />,
    },
    Badge: {
      fields: {
        text: { type: 'text' },
        variant: {
          type: 'select',
          options: opts([
            'outline',
            'destructive',
            'orange',
            'yellow',
            'blue',
            'green',
            'slate',
          ] as const),
        },
      },
      defaultProps: { text: 'Badge', variant: 'slate' },
      render: (props) => <LocalizedBadge {...props} />,
    },
    Alert: {
      fields: {
        variant: {
          type: 'select',
          options: opts(['default', 'destructive', 'warning', 'info'] as const),
        },
        title: { type: 'text' },
        description: { type: 'textarea' },
      },
      defaultProps: { variant: 'info', title: 'Alert', description: '' },
      render: (props) => <LocalizedAlert {...props} />,
    },
    Card: {
      fields: {
        title: { type: 'text' },
        description: { type: 'text' },
        body: { type: 'textarea' },
      },
      defaultProps: { title: '', description: '', body: '' },
      render: (props) => <LocalizedCard {...props} />,
    },
    Collection: registerConnectedBlock<TaleComponents['Collection']>(
      'Collection',
      {
        fields: { title: { type: 'text' } },
        render: ({
          title,
          query,
          columns,
          actions,
          subjectType,
          subjectIdField,
          perPage,
          filters,
          emptyState,
          addAction,
          search,
          onRowClick,
        }) =>
          query ? (
            <Collection
              title={title}
              query={query}
              columns={columns}
              actions={actions}
              subjectType={subjectType}
              subjectIdField={subjectIdField}
              perPage={perPage}
              filters={filters}
              emptyState={emptyState}
              addAction={addAction}
              search={search}
              onRowClick={onRowClick}
            />
          ) : (
            <></>
          ),
      },
    ),
    ReviewQueue: registerConnectedBlock<TaleComponents['ReviewQueue']>(
      'ReviewQueue',
      {
        fields: { title: { type: 'text' } },
        render: ({ title, query }) =>
          query ? <ReviewQueue title={title} query={query} /> : <></>,
      },
    ),
    AgentList: registerConnectedBlock<TaleComponents['AgentList']>(
      'AgentList',
      {
        fields: { title: { type: 'text' } },
        render: ({ title, agents, roles }) => (
          <AgentList title={title} agents={agents} roles={roles} />
        ),
      },
    ),
    WorkflowDag: registerConnectedBlock<TaleComponents['WorkflowDag']>(
      'WorkflowDag',
      {
        fields: { title: { type: 'text' } },
        render: ({ title, workflowSlug, executionId, editable }) =>
          workflowSlug ? (
            <WorkflowDag
              title={title}
              workflowSlug={workflowSlug}
              executionId={executionId}
              editable={editable}
            />
          ) : (
            <></>
          ),
      },
    ),
    RunList: registerConnectedBlock<TaleComponents['RunList']>('RunList', {
      fields: { title: { type: 'text' } },
      render: ({ title, workflowSlug }) =>
        workflowSlug ? (
          <RunList title={title} workflowSlug={workflowSlug} />
        ) : (
          <></>
        ),
    }),
    ExternalList: registerConnectedBlock<TaleComponents['ExternalList']>(
      'ExternalList',
      {
        fields: { title: { type: 'text' } },
        render: ({
          title,
          source,
          itemsKey,
          rowWhen,
          columns,
          actions,
          perPage,
          excludeBy,
        }) =>
          source?.path ? (
            <ExternalList
              title={title}
              source={source}
              itemsKey={itemsKey}
              rowWhen={rowWhen}
              columns={columns}
              actions={actions}
              perPage={perPage}
              excludeBy={excludeBy}
            />
          ) : (
            <></>
          ),
      },
    ),
    // The blocks below ship their registration payload (`{fields, render}`)
    // from their own module — this file only names them (the schema
    // discriminators in `lib/shared/schemas/automation_views.ts`) and adds the
    // per-block error boundary via `registerConnectedBlock`.
    StatGrid: registerConnectedBlock<TaleComponents['StatGrid']>(
      'StatGrid',
      statGridBlock,
    ),
    ChartCard: registerConnectedBlock<TaleComponents['ChartCard']>(
      'ChartCard',
      chartCardBlock,
    ),
    DetailPanel: registerConnectedBlock<TaleComponents['DetailPanel']>(
      'DetailPanel',
      detailPanelBlock,
    ),
    Form: registerConnectedBlock<TaleComponents['Form']>('Form', formBlock),
    Board: registerConnectedBlock<TaleComponents['Board']>('Board', boardBlock),
    AgentChat: registerConnectedBlock<TaleComponents['AgentChat']>(
      'AgentChat',
      agentChatBlock,
    ),
  },
};

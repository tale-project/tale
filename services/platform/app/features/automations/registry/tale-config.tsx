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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tale/ui/card';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';

import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';

import { BlockFrame } from './block-frame';
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
  conversationListBlock,
  type ConversationListProps,
} from './connected/conversation-list';
import {
  conversationThreadBlock,
  type ConversationThreadProps,
} from './connected/conversation-thread';
import {
  detailPanelBlock,
  type DetailPanelProps,
} from './connected/detail-panel';
import {
  ExternalList,
  type ExternalListProps,
} from './connected/external-list';
import { formBlock, type FormBlockProps } from './connected/form';
import {
  messageComposerBlock,
  type MessageComposerProps,
} from './connected/message-composer';
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

interface TaleComponents {
  Heading: { text: string; level: 1 | 2 | 3 | 4 | 5 | 6 };
  Text: { text: string; variant: TextVariant };
  Badge: { text: string; variant: BadgeVariant };
  Alert: { variant: AlertVariant; title: string; description: string };
  Card: { title: string; description: string; body: string };
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
  ConversationList: Partial<ConversationListProps>;
  ConversationThread: Partial<ConversationThreadProps>;
  MessageComposer: Partial<MessageComposerProps>;
  AgentChat: Partial<AgentChatBlockProps>;
}

const opts = <T extends string | number>(values: readonly T[]) =>
  values.map((v) => ({ label: String(v), value: v }));

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
  components: {
    Heading: {
      fields: {
        text: { type: 'text' },
        level: { type: 'select', options: opts([1, 2, 3, 4, 5, 6] as const) },
      },
      defaultProps: { text: 'Heading', level: 2 },
      // Display strings are literals rendered verbatim (UI translations are
      // platform-owned) — same posture as every presentational block below.
      render: ({ text, level }) => <Heading level={level}>{text}</Heading>,
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
      render: ({ text, variant }) => <Text variant={variant}>{text}</Text>,
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
      render: ({ text, variant }) => <Badge variant={variant}>{text}</Badge>,
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
      render: ({ variant, title, description }) => (
        <Alert variant={variant} title={title} description={description} />
      ),
    },
    Card: {
      fields: {
        title: { type: 'text' },
        description: { type: 'text' },
        body: { type: 'textarea' },
      },
      defaultProps: { title: '', description: '', body: '' },
      render: ({ title, description, body }) => (
        <Card>
          {(title || description) && (
            <CardHeader className="pb-3">
              {title ? <CardTitle>{title}</CardTitle> : null}
              {description ? (
                <CardDescription>{description}</CardDescription>
              ) : null}
            </CardHeader>
          )}
          <CardContent>{body}</CardContent>
        </Card>
      ),
    },
    Collection: registerConnectedBlock<TaleComponents['Collection']>(
      'Collection',
      {
        fields: { title: { type: 'text' } },
        render: ({
          title,
          query,
          columns,
          columnLabels,
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
              columnLabels={columnLabels}
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
          columnLabels,
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
              columnLabels={columnLabels}
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
    ConversationList: registerConnectedBlock<
      TaleComponents['ConversationList']
    >('ConversationList', conversationListBlock),
    ConversationThread: registerConnectedBlock<
      TaleComponents['ConversationThread']
    >('ConversationThread', conversationThreadBlock),
    MessageComposer: registerConnectedBlock<TaleComponents['MessageComposer']>(
      'MessageComposer',
      messageComposerBlock,
    ),
    AgentChat: registerConnectedBlock<TaleComponents['AgentChat']>(
      'AgentChat',
      agentChatBlock,
    ),
  },
};

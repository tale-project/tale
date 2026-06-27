'use client';

/**
 * The Tale Puck registry — `@tale/ui` components + the connected (data-bound)
 * blocks, composed by an app's view (Puck Data) and rendered headlessly with
 * `<Render config={taleConfig} data={view} />`. This replaced the old
 * configurable-view system (view parts bound to the closed data-source +
 * action-kind vocabularies): adding a component is now one registry entry
 * (eventually codegen'd over the whole library), not a bespoke panel. The
 * render-kinds vocabulary is NOT replaced by this — it still renders live
 * workflow-run steps (`ui.render`), which an app reuses via the embedded run.
 *
 * Phase 1 registers a representative presentational batch + the connected
 * blocks that the issue-desk demo needs; `fields` are minimal (the data is
 * authored as Puck JSON for now — the `<Puck>` visual editor is Phase 2).
 */
import { type Config } from '@measured/puck';
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

import { AgentList, type AgentListProps } from './connected/agent-list';
import { Collection, type CollectionProps } from './connected/collection';
import {
  ExternalList,
  type ExternalListProps,
} from './connected/external-list';
import { ReviewQueue, type ReviewQueueProps } from './connected/review';
import { RunList, type RunListProps } from './connected/run-list';
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
}

const opts = <T extends string | number>(values: readonly T[]) =>
  values.map((v) => ({ label: String(v), value: v }));

export const taleConfig: Config<TaleComponents> = {
  components: {
    Heading: {
      fields: {
        text: { type: 'text' },
        level: { type: 'select', options: opts([1, 2, 3, 4, 5, 6] as const) },
      },
      defaultProps: { text: 'Heading', level: 2 },
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
    Collection: {
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
          />
        ) : (
          <></>
        ),
    },
    ReviewQueue: {
      fields: { title: { type: 'text' } },
      render: ({ title, query }) =>
        query ? <ReviewQueue title={title} query={query} /> : <></>,
    },
    AgentList: {
      fields: { title: { type: 'text' } },
      render: ({ title, agents, roles }) => (
        <AgentList title={title} agents={agents} roles={roles} />
      ),
    },
    WorkflowDag: {
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
    RunList: {
      fields: { title: { type: 'text' } },
      render: ({ title, workflowSlug }) =>
        workflowSlug ? (
          <RunList title={title} workflowSlug={workflowSlug} />
        ) : (
          <></>
        ),
    },
    ExternalList: {
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
  },
};

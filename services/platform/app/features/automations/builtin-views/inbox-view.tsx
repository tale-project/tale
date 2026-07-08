'use client';

/**
 * The platform-rendered conversation inbox — the builtin view
 * (`builtinViews: [{ id: 'inbox' }]`) behind the three email automations
 * today (`reply-outlook-emails` / `reply-gmail-emails` / `reply-imap-emails`), but channel-generic
 * by design: any automation whose provider syncs into the shared
 * `conversations` table (email, WhatsApp, Teams, Telegram, …) can declare the
 * same `builtinViews` entry and get this view. It reproduces the UX the email
 * bundles used to ship as `views/inbox.json`, but as PLATFORM code: four
 * status tabs (Open / Closed / Spam / Archived), each a split layout of a
 * `ConversationList` beside a `ConversationThread` (+ `MessageComposer` on
 * Open only) — composed from the SAME connected registry blocks by rendering
 * the equivalent Puck documents through `AutomationView`.
 *
 * Strings come from the platform catalog (`automations.inbox.*`), injected
 * into the documents as literals — there is no bundle label catalog to
 * resolve against. The provider (integration slug baked into every query)
 * derives from the manifest's `requires.integrations`, so any number of
 * provider automations share this one view with zero per-provider code or config.
 *
 * The function allowlist is PLATFORM-TRUSTED: the JSON allowlist
 * (`capabilities.functions`) exists to gate untrusted bundle documents, and
 * this view is not one — it re-provides the automation runtime with the fixed
 * binding set below (exactly what the email manifests declare today, and any
 * future channel automation would reuse as-is). Each tab wraps its two
 * columns in ONE `ViewStateProvider`, the documented split-layout
 * composition, so the list's selection drives the thread pane.
 */
import { Grid } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

import { AutomationView } from '../registry/automation-view';
import {
  AutomationRuntimeProvider,
  useAutomationRuntime,
} from '../runtime/automation-runtime';
import { ViewStateProvider } from '../runtime/view-state';
import type { BuiltinViewProps } from './registry';

/** The Convex functions the inbox documents bind — platform-trusted. */
const INBOX_FUNCTIONS: FunctionBinding[] = [
  { path: 'conversations/queries:listConversationsPaginated', mode: 'query' },
  {
    path: 'conversations/queries:approxCountConversationsByStatus',
    mode: 'query',
  },
  {
    path: 'conversations/queries:approxCountUnreadConversations',
    mode: 'query',
  },
  { path: 'conversations/queries:getConversationWithMessages', mode: 'query' },
  { path: 'conversations/mutations:replyToConversation', mode: 'mutation' },
  { path: 'conversations/mutations:closeConversation', mode: 'mutation' },
  { path: 'conversations/mutations:reopenConversation', mode: 'mutation' },
  { path: 'conversations/mutations:markConversationAsSpam', mode: 'mutation' },
  { path: 'conversations/mutations:markConversationAsRead', mode: 'mutation' },
  { path: 'conversations/mutations:deleteConversation', mode: 'mutation' },
  { path: 'conversations/mutations:downloadAttachments', mode: 'mutation' },
  { path: 'conversations/mutations:bulkCloseConversations', mode: 'mutation' },
  { path: 'conversations/mutations:bulkReopenConversations', mode: 'mutation' },
  {
    path: 'conversations/mutations:bulkArchiveConversations',
    mode: 'mutation',
  },
  {
    path: 'conversations/mutations:bulkUnarchiveConversations',
    mode: 'mutation',
  },
  { path: 'conversations/mutations:bulkSpamConversations', mode: 'mutation' },
  { path: 'conversations/actions:improveMessage', mode: 'action' },
];

type ConversationStatus = 'open' | 'closed' | 'spam' | 'archived';

interface InboxStrings {
  tabs: Record<ConversationStatus, string>;
  empty: Record<ConversationStatus, string>;
  threadPlaceholder: string;
  composerPlaceholder: string;
  action: {
    close: string;
    markSpam: string;
    reopen: string;
    notSpam: string;
    delete: string;
    download: string;
  };
  bulk: {
    close: string;
    archive: string;
    markSpam: string;
    reopen: string;
    unarchive: string;
  };
}

/** A single-column Puck data document wrapping `content`. */
const column = (content: unknown[]) => ({
  root: { props: {} },
  zones: {},
  content,
});

/** Query args scoped to the automation's provider (absent slug ⇒ unscoped). */
const scoped = (
  args: Record<string, unknown>,
  integrationName: string | undefined,
) => ({
  ...args,
  ...(integrationName !== undefined && { integrationName }),
});

function listColumn(
  status: ConversationStatus,
  integrationName: string | undefined,
  strings: InboxStrings,
) {
  const bulkActions =
    status === 'open'
      ? [
          {
            label: strings.bulk.close,
            path: 'conversations/mutations:bulkCloseConversations',
            mode: 'mutation',
            args: { conversationIds: '$selection.ids' },
          },
          {
            label: strings.bulk.archive,
            path: 'conversations/mutations:bulkArchiveConversations',
            mode: 'mutation',
            args: { conversationIds: '$selection.ids' },
          },
          {
            label: strings.bulk.markSpam,
            path: 'conversations/mutations:bulkSpamConversations',
            mode: 'mutation',
            args: { conversationIds: '$selection.ids' },
          },
        ]
      : status === 'closed'
        ? [
            {
              label: strings.bulk.reopen,
              path: 'conversations/mutations:bulkReopenConversations',
              mode: 'mutation',
              args: { conversationIds: '$selection.ids' },
            },
          ]
        : status === 'spam'
          ? [
              {
                label: strings.action.notSpam,
                path: 'conversations/mutations:bulkReopenConversations',
                mode: 'mutation',
                args: { conversationIds: '$selection.ids' },
              },
            ]
          : [
              {
                label: strings.bulk.unarchive,
                path: 'conversations/mutations:bulkUnarchiveConversations',
                mode: 'mutation',
                args: { conversationIds: '$selection.ids' },
              },
            ];

  return column([
    {
      type: 'ConversationList',
      props: {
        id: status,
        query: {
          path: 'conversations/queries:listConversationsPaginated',
          args: scoped({ organizationId: '$orgId', status }, integrationName),
        },
        count:
          status === 'open'
            ? {
                path: 'conversations/queries:approxCountUnreadConversations',
                args: scoped({ organizationId: '$orgId' }, integrationName),
              }
            : {
                path: 'conversations/queries:approxCountConversationsByStatus',
                args: scoped(
                  { organizationId: '$orgId', status },
                  integrationName,
                ),
              },
        perPage: 30,
        item: {
          titleField: 'title',
          senderField: 'senderName',
          previewField: 'lastMessagePreview',
          timestampField: 'lastMessageAt',
          unreadField: 'unread_count',
          badgeField: 'status',
          badgeLabels: {
            open: strings.tabs.open,
            closed: strings.tabs.closed,
            spam: strings.tabs.spam,
            archived: strings.tabs.archived,
          },
        },
        selection: { stateKey: 'conversationId', idField: '_id' },
        onOpen: {
          path: 'conversations/mutations:markConversationAsRead',
          mode: 'mutation',
          args: { conversationId: '$selected._id' },
        },
        bulkActions,
        emptyState: { titleKey: strings.empty[status] },
      },
    },
  ]);
}

function threadColumn(
  status: ConversationStatus,
  integrationName: string | undefined,
  strings: InboxStrings,
) {
  const content: unknown[] = [
    {
      type: 'ConversationThread',
      props: {
        query: {
          path: 'conversations/queries:getConversationWithMessages',
          args: {
            conversationId: '$state.conversationId',
            organizationId: '$orgId',
          },
        },
        message: {
          authorField: 'sender',
          bodyField: 'content',
          bodyFormat: 'html',
          timestampField: 'timestamp',
          directionField: 'isCustomer',
          deliveryStateField: 'status',
        },
        placeholderKey: strings.threadPlaceholder,
        actions: [
          {
            label: strings.action.close,
            path: 'conversations/mutations:closeConversation',
            mode: 'mutation',
            when: 'status == open',
            args: { conversationId: '$selected._id' },
          },
          {
            label: strings.action.markSpam,
            path: 'conversations/mutations:markConversationAsSpam',
            mode: 'mutation',
            when: 'status == open',
            args: { conversationId: '$selected._id' },
          },
          {
            label: strings.action.reopen,
            path: 'conversations/mutations:reopenConversation',
            mode: 'mutation',
            when: 'status == closed || status == archived',
            args: { conversationId: '$selected._id' },
          },
          {
            label: strings.action.notSpam,
            path: 'conversations/mutations:reopenConversation',
            mode: 'mutation',
            when: 'status == spam',
            args: { conversationId: '$selected._id' },
          },
          {
            label: strings.action.delete,
            path: 'conversations/mutations:deleteConversation',
            mode: 'mutation',
            when: 'status == spam',
            confirm: true,
            variant: 'destructive',
            args: { conversationId: '$selected._id' },
          },
        ],
        attachmentAction: {
          label: strings.action.download,
          path: 'conversations/mutations:downloadAttachments',
          mode: 'mutation',
          args: { messageId: '$selected.messageId' },
        },
      },
    },
  ];
  if (status === 'open') {
    content.push({
      type: 'MessageComposer',
      props: {
        submit: {
          path: 'conversations/mutations:replyToConversation',
          mode: 'mutation',
          args: {
            conversationId: '$state.conversationId',
            organizationId: '$orgId',
            content: '$input.body',
          },
        },
        improve: {
          path: 'conversations/actions:improveMessage',
          mode: 'action',
          args: { originalMessage: '$input.body', organizationId: '$orgId' },
        },
        requiresState: 'conversationId',
        placeholderKey: strings.composerPlaceholder,
      },
    });
  }
  return column(content);
}

const STATUSES: ConversationStatus[] = ['open', 'closed', 'spam', 'archived'];

export function InboxView({ automation }: BuiltinViewProps) {
  const { t } = useT('automations');
  const runtime = useAutomationRuntime();
  // The provider the manifest requires (e.g. `gmail`) scopes every query; a
  // manifest declaring no integration degrades to the unscoped inbox.
  const integrationName = automation.requiredIntegrations[0];

  const trustedRuntime = useMemo(
    () => ({ ...runtime, allowlist: INBOX_FUNCTIONS }),
    [runtime],
  );

  const tabs = useMemo(() => {
    const strings: InboxStrings = {
      tabs: {
        open: t('inbox.tab.open'),
        closed: t('inbox.tab.closed'),
        spam: t('inbox.tab.spam'),
        archived: t('inbox.tab.archived'),
      },
      empty: {
        open: t('inbox.empty.open'),
        closed: t('inbox.empty.closed'),
        spam: t('inbox.empty.spam'),
        archived: t('inbox.empty.archived'),
      },
      threadPlaceholder: t('inbox.thread.placeholder'),
      composerPlaceholder: t('inbox.composer.placeholder'),
      action: {
        close: t('inbox.action.close'),
        markSpam: t('inbox.action.markSpam'),
        reopen: t('inbox.action.reopen'),
        notSpam: t('inbox.action.notSpam'),
        delete: t('inbox.action.delete'),
        download: t('inbox.action.download'),
      },
      bulk: {
        close: t('inbox.bulk.close'),
        archive: t('inbox.bulk.archive'),
        markSpam: t('inbox.bulk.markSpam'),
        reopen: t('inbox.bulk.reopen'),
        unarchive: t('inbox.bulk.unarchive'),
      },
    };
    return STATUSES.map((status) => ({
      status,
      label: strings.tabs[status],
      list: listColumn(status, integrationName, strings),
      thread: threadColumn(status, integrationName, strings),
    }));
  }, [t, integrationName]);

  return (
    <AutomationRuntimeProvider value={trustedRuntime}>
      <Tabs
        variant="underline"
        defaultValue="open"
        items={tabs.map((tab) => ({
          value: tab.status,
          label: tab.label,
          content: (
            // ONE state store above both columns — the list's
            // `selection.stateKey` drives the thread's `$state.conversationId`.
            <ViewStateProvider>
              <Grid lg={2} className="items-start">
                <AutomationView data={tab.list} />
                <AutomationView data={tab.thread} />
              </Grid>
            </ViewStateProvider>
          ),
        }))}
      />
    </AutomationRuntimeProvider>
  );
}

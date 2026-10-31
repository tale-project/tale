'use client';

import { Badge, type BadgeProps } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Loader2, RefreshCw } from 'lucide-react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { readStateOf } from '@/app/lib/backend/read-state';
import {
  CHAT_WORK_TOOLS,
  type ChatWorkTool,
  type ChatWorkToolReason,
  type ChatWorkToolReasonCode,
  type ChatWorkToolState,
  type ChatWorkToolStatus,
  type ChatWorkToolsStatus,
  type SandboxStartFailure,
} from '@/lib/chat/work-tools-status';
import { useT } from '@/lib/i18n/client';

import { useChatWorkToolsStatus } from '../hooks/queries';

interface ChatToolStatusProps {
  organizationId: string;
}

const TOOL_LABELS = {
  files: 'chatTools.files',
  code: 'chatTools.code',
  skills: 'chatTools.skills',
  images: 'chatToolStatus.images',
} as const satisfies Record<ChatWorkTool, string>;

// Unavailable is not an alarm: a switch an admin turned off says so too.
const STATES = {
  available: { label: 'chatToolStatus.states.available', variant: 'green' },
  limited: { label: 'chatToolStatus.states.limited', variant: 'orange' },
  unavailable: { label: 'chatToolStatus.states.unavailable', variant: 'slate' },
} as const satisfies Record<
  ChatWorkToolState,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
>;

const REASONS = {
  policy_off: 'chatToolStatus.reasons.policyOff',
  policy_unreadable: 'chatToolStatus.reasons.policyUnreadable',
  sandbox_not_configured: 'chatToolStatus.reasons.sandboxNotConfigured',
  sandbox_unreachable: 'chatToolStatus.reasons.sandboxUnreachable',
  skill_library_unreadable: 'chatToolStatus.reasons.skillLibraryUnreadable',
  image_generation_off: 'chatToolStatus.reasons.imageGenerationOff',
  image_policy_unreadable: 'chatToolStatus.reasons.imagePolicyUnreadable',
  no_image_model: 'chatToolStatus.reasons.noImageModel',
  image_model_unavailable: 'chatToolStatus.reasons.imageModelUnavailable',
  image_model_outside_eu: 'chatToolStatus.reasons.imageModelOutsideEu',
  model_access_unreadable: 'chatToolStatus.reasons.modelAccessUnreadable',
  image_model_check_failed: 'chatToolStatus.reasons.imageModelCheckFailed',
} as const satisfies Record<
  Exclude<
    ChatWorkToolReasonCode,
    'sandbox_start_failed' | 'document_skills_missing'
  >,
  string
>;

/** A failed start in the words the reply's step showed for it. */
const START_FAILURES = {
  sandbox_not_ready: 'thinking.outcome.sandboxNotReady',
  sandbox_unreachable: 'thinking.outcome.sandboxUnreachable',
  sandbox_failed: 'thinking.outcome.sandboxFailed',
  sandboxes_busy: 'thinking.outcome.sandboxesBusy',
  sandbox_host_busy: 'thinking.outcome.sandboxHostBusy',
} as const satisfies Record<SandboxStartFailure, string>;

const LOADING_TOOLS: readonly ChatWorkToolStatus[] = CHAT_WORK_TOOLS.map(
  (tool) => ({ tool, state: 'available', reasons: [] }),
);

function ToolRow({
  entry,
  imageModel,
}: {
  entry: ChatWorkToolStatus;
  imageModel: ChatWorkToolsStatus['imageModel'];
}) {
  const { t } = useT('governance');
  const { t: tChat } = useT('chat');
  const { formatDate, locale } = useFormatDate();
  const state = STATES[entry.state];

  const say = (reason: ChatWorkToolReason): string => {
    switch (reason.code) {
      case 'sandbox_start_failed':
        return t('chatToolStatus.reasons.sandboxStartFailed', {
          when: formatDate(new Date(reason.at), 'long'),
          failure: tChat(START_FAILURES[reason.failure]),
        });
      case 'document_skills_missing':
        return t('chatToolStatus.reasons.documentSkillsMissing', {
          skills: new Intl.ListFormat(locale, {
            style: 'long',
            type: 'conjunction',
          }).format(reason.missing),
        });
      default:
        return t(REASONS[reason.code]);
    }
  };
  const lines: { key: string; text: string }[] = entry.reasons.map(
    (reason) => ({
      key: reason.code,
      text: say(reason),
    }),
  );
  if (entry.tool === 'images' && imageModel !== undefined) {
    lines.push({
      key: 'model',
      text: t('chatToolStatus.imageModel', {
        model: imageModel.modelId,
        provider: imageModel.providerName,
      }),
    });
  }

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground text-sm font-medium">
          {t(TOOL_LABELS[entry.tool])}
        </span>
        <Badge variant={state.variant} dot>
          {t(state.label)}
        </Badge>
      </div>
      {lines.map((line) => (
        <Text key={line.key} variant="muted">
          {line.text}
        </Text>
      ))}
    </li>
  );
}

// =============================================================================
// Whether chat in the organization can make files, run code, use skills and
// make images right now, and what stands in the way where it cannot: the
// switches above, the sandbox service, the skill library, the image model.
// Owners and admins only, like the read behind it. Check again is the one
// way to ask anew — also after a failed read, so the focus never has to
// move off a retry that disappears.
// =============================================================================
export function ChatToolStatus({ organizationId }: ChatToolStatusProps) {
  const { t } = useT('governance');
  const { formatDate } = useFormatDate();
  const ability = useAbility();
  const canRead = ability.can('read', 'orgSettings');
  const status = useChatWorkToolsStatus(organizationId, { enabled: canRead });
  const read = readStateOf(status);

  if (!canRead) return null;

  const checking = status.isFetching;

  return (
    <Skeletonize
      loading={status.data === undefined && !read.unavailable}
      label={t('chatToolStatus.title')}
    >
      <SettingsSection
        title={t('chatToolStatus.title')}
        description={t('chatToolStatus.description')}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={checking ? Loader2 : RefreshCw}
            iconClassName={
              checking ? 'animate-spin motion-reduce:animate-none' : undefined
            }
            aria-busy={checking || undefined}
            aria-disabled={checking || undefined}
            onClick={checking ? undefined : () => void status.refetch()}
          >
            {t('chatToolStatus.checkAgain')}
          </Button>
        }
      >
        {(read.unavailable || read.stale) && (
          <CatalogLoadError
            failureKey={read.failureCount}
            message={t(
              read.unavailable
                ? 'chatToolStatus.loadFailed'
                : 'chatToolStatus.refreshFailed',
            )}
          />
        )}
        {!read.unavailable && (
          <Stack gap={2}>
            <ul
              aria-label={t('chatToolStatus.title')}
              className="border-border divide-border divide-y rounded-lg border"
            >
              {(status.data?.tools ?? LOADING_TOOLS).map((entry) => (
                <ToolRow
                  key={entry.tool}
                  entry={entry}
                  imageModel={status.data?.imageModel}
                />
              ))}
            </ul>
            {status.data !== undefined && (
              <Text variant="caption" aria-live="polite">
                {t('chatToolStatus.checkedAt', {
                  time: formatDate(new Date(status.data.checkedAt), 'time'),
                })}
              </Text>
            )}
          </Stack>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}

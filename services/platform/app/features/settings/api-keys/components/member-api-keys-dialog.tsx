'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import { useId, useRef, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import {
  useMemberPersonalApiKeys,
  useSetApiKeyBlock,
} from '../hooks/use-api-keys';
import { maskedKey } from '../masked-key';
import type { MemberPersonalApiKey, MemberPersonalApiKeys } from '../types';

interface MemberApiKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  member: {
    userId: string;
    displayName?: string;
    email?: string;
  };
}

const LOADING_KEYS: readonly MemberPersonalApiKey[] = [0, 1].map((index) => ({
  id: `loading-${index}`,
  name: 'Loading key',
  start: 'tale_xxxx',
  prefix: null,
  suffix: null,
  enabled: true,
  expiresAt: null,
  createdAt: 0,
  blocked: null,
}));

type Standing = MemberPersonalApiKeys['personalKeys'];

/** What a key's badge may claim of it here. A block is this organization's
 * own record, so it always shows; whether an unblocked key works here also
 * takes the organization letting members' own keys in (APIKEY-R12), and
 * while that cannot be read the badge claims nothing. */
const STATE = {
  blocked: { variant: 'destructive', label: 'apiKeys.memberKeys.blocked' },
  admitted: { variant: 'green', label: 'apiKeys.memberKeys.works' },
  refused: { variant: 'orange', label: 'apiKeys.memberKeys.refused' },
} as const;

const NOTICE = {
  refused: 'apiKeys.memberKeys.refusedNotice',
  unavailable: 'apiKeys.memberKeys.unavailableNotice',
} as const;

interface KeyRowProps {
  apiKey: MemberPersonalApiKey;
  standing: Standing;
  canBlock: boolean;
  disabled: boolean;
  onToggle: (apiKey: MemberPersonalApiKey) => void;
}

function KeyRow({
  apiKey,
  standing,
  canBlock,
  disabled,
  onToggle,
}: KeyRowProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const id = useId();
  const name = apiKey.name || maskedKey(apiKey);
  const state =
    apiKey.blocked !== null
      ? STATE.blocked
      : standing === 'unavailable'
        ? null
        : STATE[standing];

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            id={`${id}-name`}
            className="text-foreground text-sm font-medium"
          >
            {name}
          </span>
          {state !== null && (
            <Badge id={`${id}-state`} variant={state.variant} dot>
              {t(state.label)}
            </Badge>
          )}
        </div>
        <Text as="span" variant="muted" className="font-mono text-xs">
          {maskedKey(apiKey)}
        </Text>
        <Text as="span" variant="muted" className="text-xs">
          {apiKey.blocked !== null
            ? t('apiKeys.memberKeys.blockedBy', {
                name: apiKey.blocked.by.name ?? tCommon('formerMember'),
                date: formatDate(new Date(apiKey.blocked.at), 'short'),
              })
            : t('apiKeys.memberKeys.created', {
                date: formatDate(new Date(apiKey.createdAt), 'short'),
              })}
        </Text>
      </div>
      {canBlock && (
        <Button
          variant={apiKey.blocked !== null ? 'secondary' : 'destructive'}
          size="sm"
          className="shrink-0"
          disabled={disabled}
          aria-describedby={
            state !== null ? `${id}-name ${id}-state` : `${id}-name`
          }
          onClick={() => onToggle(apiKey)}
        >
          {t(
            apiKey.blocked !== null
              ? 'apiKeys.memberKeys.unblock'
              : 'apiKeys.memberKeys.block',
          )}
        </Button>
      )}
    </li>
  );
}

/**
 * A member's own API keys, for an Owner or Admin: each can be blocked here,
 * and here only, or freed again (APIKEY-R11). Whether an unblocked key works
 * here also takes this organization letting members' own keys in
 * (APIKEY-R12): while it does not, or while that cannot be read, the dialog
 * says so and marks no key as working. An Admin sees an Owner's keys but
 * cannot block them.
 */
export function MemberApiKeysDialog({
  open,
  onOpenChange,
  organizationId,
  member,
}: MemberApiKeysDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const keys = useMemberPersonalApiKeys(organizationId, member.userId, {
    enabled: open,
  });
  const read = readStateOf(keys);
  const setBlock = useSetApiKeyBlock(organizationId);
  const [target, setTarget] = useState<MemberPersonalApiKey | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const memberName = member.displayName || member.email || member.userId;
  const title = t('apiKeys.memberKeys.title', { name: memberName });
  const blocking = target !== null && target.blocked === null;
  const targetName = target ? target.name || maskedKey(target) : '';

  const handleConfirm = async () => {
    if (target === null) return;
    const blocked = target.blocked === null;
    try {
      await setBlock.mutateAsync({ keyId: target.id, blocked });
      toast({
        title: t(
          blocked
            ? 'apiKeys.memberKeys.toasts.blocked'
            : 'apiKeys.memberKeys.toasts.unblocked',
        ),
        variant: 'success',
      });
      setTarget(null);
    } catch (error) {
      toast({
        title: t(
          blocked
            ? 'apiKeys.memberKeys.toasts.blockFailed'
            : 'apiKeys.memberKeys.toasts.unblockFailed',
        ),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  };

  const list = keys.data?.keys ?? LOADING_KEYS;
  const standing = keys.data?.personalKeys;

  return (
    <>
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={t('apiKeys.memberKeys.description', { name: memberName })}
        size="lg"
      >
        {(read.unavailable || read.stale) && (
          <CatalogLoadError
            failureKey={read.failureCount}
            isRetrying={read.retrying}
            onRetry={() => void keys.refetch()}
            // A retry that reads the keys takes the notice, and the focus on
            // its button, away: hand the focus to the keys.
            onFocusLost={() => listRef.current?.focus()}
            message={t(
              read.unavailable
                ? 'apiKeys.memberKeys.loadFailed'
                : 'apiKeys.memberKeys.refreshFailed',
            )}
          />
        )}
        {(standing === 'refused' || standing === 'unavailable') && (
          // Static while it holds: it states a condition of the keys, it
          // does not announce an event.
          <Alert
            variant="warning"
            live="off"
            className="mb-3"
            description={t(NOTICE[standing])}
          />
        )}
        {!read.unavailable &&
          (keys.data !== undefined && keys.data.keys.length === 0 ? (
            <Text variant="muted">
              {t('apiKeys.memberKeys.empty', { name: memberName })}
            </Text>
          ) : (
            <Skeletonize loading={keys.data === undefined} label={title}>
              <ul
                ref={listRef}
                tabIndex={-1}
                aria-label={title}
                className="border-border divide-border divide-y rounded-lg border"
              >
                {list.map((apiKey) => (
                  <KeyRow
                    key={apiKey.id}
                    apiKey={apiKey}
                    standing={standing ?? 'admitted'}
                    canBlock={keys.data?.canBlock ?? false}
                    // A button acts on an answer: never on the placeholder
                    // rows, nor while a change is on its way.
                    disabled={keys.data === undefined || setBlock.isPending}
                    onToggle={setTarget}
                  />
                ))}
              </ul>
            </Skeletonize>
          ))}
        {keys.data !== undefined && !keys.data.canBlock && (
          <Text variant="muted" className="mt-3 text-xs">
            {t('apiKeys.memberKeys.cannotBlock')}
          </Text>
        )}
      </ViewDialog>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        variant={blocking ? 'destructive' : 'default'}
        title={t(
          blocking
            ? 'apiKeys.memberKeys.blockDialog.title'
            : 'apiKeys.memberKeys.unblockDialog.title',
        )}
        description={t(
          blocking
            ? 'apiKeys.memberKeys.blockDialog.description'
            : 'apiKeys.memberKeys.unblockDialog.description',
          { keyName: targetName, name: memberName },
        )}
        confirmText={t(
          blocking
            ? 'apiKeys.memberKeys.blockDialog.confirm'
            : 'apiKeys.memberKeys.unblockDialog.confirm',
        )}
        cancelText={tCommon('actions.cancel')}
        isLoading={setBlock.isPending}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}

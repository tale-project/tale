'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Hand, Loader2, XCircle } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { useReturnHumanControl } from '@/app/features/chat/hooks/mutations';
import { useLiveBrowserOptional } from '@/app/features/workspace/components/live-browser-context';
import type { Id } from '@/convex/_generated/dataModel';
import type { HumanControlMetadata } from '@/convex/approvals/types';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { ApprovalCard } from './approval-card';

interface HumanControlCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: HumanControlMetadata;
  className?: string;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ConvexError && isRecord(err.data)) {
    const code = err.data.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Inline browser-handoff card. The agent called request_human_control and
 * parked its turn; this card lets the user TAKE control of the live browser
 * (opens the pane with a writable VNC stream) to complete a CAPTCHA / login /
 * 2FA, then RETURN control — which resumes the agent in the same session. Like
 * the plan card it stays inline and never disables the composer.
 */
function HumanControlCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  className,
}: HumanControlCardProps) {
  const { t } = useT('chat');
  const liveBrowser = useLiveBrowserOptional();
  const { mutateAsync: returnHumanControl } = useReturnHumanControl();
  const [isReturning, setIsReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = status === 'pending';
  const superseded = typeof metadata.supersededBy === 'string';
  // This pane is the one currently driving the browser.
  const controlling = liveBrowser?.control === true;

  // When the handoff resolves (returned elsewhere, or the no-human timeout
  // fired), drop this pane out of control mode so it falls back to a mirror.
  useEffect(() => {
    if (!isPending && controlling) liveBrowser?.setControl(false);
  }, [isPending, controlling, liveBrowser]);

  const handleTakeControl = () => {
    setError(null);
    // Opens the pane (if closed) and connects with ?control=1.
    liveBrowser?.open({ control: true });
  };

  const handleReturn = async () => {
    setIsReturning(true);
    setError(null);
    try {
      await returnHumanControl({ approvalId, organizationId });
      liveBrowser?.setControl(false);
    } catch (err) {
      const code = errorCode(err);
      setError(
        code === 'ALREADY_RESOLVED'
          ? t('humanControl.errorAlreadyResolved', {
              defaultValue: 'This handoff was already resolved.',
            })
          : code === 'TURN_RUNNING'
            ? t('humanControl.errorTurnRunning', {
                defaultValue: 'The agent is already running again.',
              })
            : t('humanControl.errorReturnFailed', {
                defaultValue: 'Couldn’t return control. Please try again.',
              }),
      );
      console.error('Failed to return browser control:', err);
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <ApprovalCard maxWidth="2xl" className={className}>
      <HStack gap={2} align="center" className="mb-2">
        <Hand className="text-primary size-4 shrink-0" />
        <Text as="div" variant="label">
          {t('humanControl.cardTitle', {
            defaultValue: 'The agent needs your help in the browser',
          })}
        </Text>
      </HStack>

      <Text as="div" className="mb-3 text-sm">
        {metadata.reason}
      </Text>

      {error && (
        <HStack
          gap={1}
          align="start"
          className="text-destructive mb-3 text-xs wrap-break-word"
        >
          <XCircle className="size-3 shrink-0" />
          <Text as="span" className="min-w-0">
            {error}
          </Text>
        </HStack>
      )}

      {isPending && (
        <>
          <ActionRow gap={2} className="mt-1">
            {controlling ? (
              <Button
                variant="primary"
                onClick={handleReturn}
                disabled={isReturning}
                className="flex-1"
              >
                {isReturning && (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                )}
                {t('humanControl.returnControl', {
                  defaultValue: 'Done — return control',
                })}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleTakeControl}
                className="flex-1"
              >
                {t('humanControl.takeControl', {
                  defaultValue: 'Take control',
                })}
              </Button>
            )}
          </ActionRow>
          <Text as="div" variant="caption" className="mt-2">
            {controlling
              ? t('humanControl.controllingHint', {
                  defaultValue:
                    'You’re driving the browser. Finish the step, then return control to resume the agent.',
                })
              : t('humanControl.takeControlHint', {
                  defaultValue:
                    'Take control to complete this step in the live browser, then hand it back.',
                })}
          </Text>
        </>
      )}

      {!isPending && (
        <HStack justify="between" align="center" className="mt-1">
          <Text as="div" variant="caption">
            {metadata.resolution === 'no_human_timeout'
              ? t('humanControl.statusTimedOut', {
                  defaultValue: 'No one took control — the agent moved on.',
                })
              : superseded
                ? t('humanControl.statusSuperseded', {
                    defaultValue: 'Replaced by a newer request.',
                  })
                : t('humanControl.statusReturned', {
                    defaultValue: 'Control returned — the agent resumed.',
                  })}
          </Text>
          <Badge
            variant={
              metadata.resolution === 'no_human_timeout' || superseded
                ? 'slate'
                : 'green'
            }
            className="shrink-0 text-xs capitalize"
          >
            {status}
          </Badge>
        </HStack>
      )}
    </ApprovalCard>
  );
}

export const HumanControlCard = memo(
  HumanControlCardComponent,
  (prevProps, nextProps) =>
    prevProps.approvalId === nextProps.approvalId &&
    prevProps.status === nextProps.status &&
    prevProps.className === nextProps.className &&
    prevProps.organizationId === nextProps.organizationId &&
    JSON.stringify(prevProps.metadata) === JSON.stringify(nextProps.metadata),
);

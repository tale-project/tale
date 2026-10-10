import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCopyButton } from '@tale/ui/use-copy';
import { Check, CircleCheck, Copy, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import type {
  SandboxDeviceJoinToken,
  SandboxDeviceView,
} from '@/lib/shared/schemas/sandbox-devices';

import { connectCommand, installAndConnectCommand } from './device-command';

interface AddDeviceDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The organization's devices as the list currently shows them. */
  devices: readonly SandboxDeviceView[];
  serverVersion: string;
  /** Re-read the device list (polled faster while a device is expected). */
  onRefresh: () => void;
}

/**
 * "Add device": mint a single-use join token and hand out the one line that
 * installs the Tale CLI on a machine and connects it to this organization.
 * The dialog then watches the device list and says when the machine arrived.
 */
export function AddDeviceDialog({
  organizationId,
  open,
  onOpenChange,
  devices,
  serverVersion,
  onRefresh,
}: AddDeviceDialogProps) {
  const { t } = useT('sandboxes');
  const { t: tCommon } = useT('common');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('devices.addDialog.title')}
      description={t('devices.addDialog.description')}
      size="lg"
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          {tCommon('actions.done')}
        </Button>
      }
    >
      {/* Mounted only while open: every opening mints a fresh token, and a
          closed dialog stops polling. */}
      {open && (
        <AddDeviceBody
          key={organizationId}
          organizationId={organizationId}
          devices={devices}
          serverVersion={serverVersion}
          onRefresh={onRefresh}
        />
      )}
    </Dialog>
  );
}

function AddDeviceBody({
  organizationId,
  devices,
  serverVersion,
  onRefresh,
}: Omit<AddDeviceDialogProps, 'open' | 'onOpenChange'>) {
  const { t } = useT('sandboxes');
  const createJoinToken = useBackendMutation(
    'sandbox_devices/mutations:createJoinToken',
    // Repairable in place: the dialog shows the failure beside a retry.
    { errorToast: false },
  );
  // The latest mutate function, so minting runs once per opening (or retry)
  // whatever the hook hands back on a re-render.
  const mint = useRef(createJoinToken.mutateAsync);
  mint.current = createJoinToken.mutateAsync;
  const [grant, setGrant] = useState<SandboxDeviceJoinToken | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const joinStatus = useBackendQuery(
    'sandbox_devices/queries:joinTokenStatus',
    grant === null ? 'skip' : { organizationId, tokenId: grant.id },
  );

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    mint.current({ organizationId }).then(
      (answer) => {
        if (!cancelled) setGrant(answer);
      },
      (error: unknown) => {
        console.warn(
          '[sandboxes] minting a device connect command failed',
          error,
        );
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  // Waiting for the machine: re-read the list every few seconds.
  const waiting = grant !== null;
  useEffect(() => {
    const timer = waiting ? setInterval(onRefresh, 3_000) : undefined;
    return () => clearInterval(timer);
  }, [waiting, onRefresh]);

  if (failed) {
    return (
      <Stack gap={3}>
        <Text as="p" role="alert">
          {t('devices.addDialog.generateFailed')}
        </Text>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('devices.addDialog.retry')}
          </Button>
        </div>
      </Stack>
    );
  }

  // While the token is minted, the same layout renders masked around a
  // same-length stand-in, so nothing moves when the real command lands.
  const serverUrl = grant?.serverUrl ?? 'https://tale.example';
  const token = grant?.token ?? `tsdj_${'0'.repeat(64)}`;
  // Joined is not arrived: the row exists from the join on, but the device is
  // online only once its containers started (the first start pulls images).
  const arrived = devices.find(
    (d) => d.id === joinStatus.data?.deviceId && d.status !== 'offline',
  );
  const oneLiner = installAndConnectCommand(serverUrl, token, serverVersion);

  return (
    <Skeletonize
      loading={grant === null}
      label={t('devices.addDialog.generating')}
    >
      <Stack gap={4}>
        <Stack gap={2}>
          <SkeletonBox className="block">
            <CodeBlock label={t('devices.addDialog.commandLabel')}>
              {oneLiner}
            </CodeBlock>
          </SkeletonBox>
          <CopyCommandButton value={oneLiner} disabled={grant === null} />
        </Stack>
        <Stack gap={1}>
          <Text as="p" variant="muted" className="text-sm">
            {t('devices.addDialog.requirements')}
          </Text>
          <Text as="p" variant="muted" className="text-sm">
            {t('devices.addDialog.expires')}
          </Text>
        </Stack>
        <SkeletonBox className="block">
          <CopyableField
            label={t('devices.addDialog.cliInstalled')}
            value={connectCommand(serverUrl, token)}
            mono
          />
        </SkeletonBox>
        {grant !== null && (
          <Text
            as="p"
            role="status"
            className="flex items-center gap-2 text-sm"
          >
            {arrived ? (
              <>
                <CircleCheck
                  className="text-success size-4"
                  aria-hidden="true"
                />
                {t('devices.addDialog.connected', { name: arrived.name })}
              </>
            ) : (
              <>
                <Loader2
                  className="text-muted-foreground size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t('devices.addDialog.waiting')}
                </span>
              </>
            )}
          </Text>
        )}
      </Stack>
    </Skeletonize>
  );
}

/** Copying the command is the dialog's whole job, so its button is always
 * visible (a code block's own copy icon only appears on hover). */
function CopyCommandButton({
  value,
  disabled,
}: {
  value: string;
  disabled: boolean;
}) {
  const { t } = useT('sandboxes');
  const { copied, onClick } = useCopyButton(value);
  return (
    <div>
      <Button
        type="button"
        size="sm"
        icon={copied ? Check : Copy}
        onClick={onClick}
        disabled={disabled}
      >
        {copied
          ? t('devices.addDialog.copied')
          : t('devices.addDialog.copyCommand')}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t('devices.addDialog.copied') : ''}
      </span>
    </div>
  );
}

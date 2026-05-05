import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Skeleton } from '@tale/ui/skeleton';
import { Check, CircleAlert, Loader2, Minus, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { useTestProviderConnection } from '../hooks/mutations';
import { useReadProvider } from '../hooks/queries';

interface ProbeRow {
  modelId: string;
  tag: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
  warning?: string;
}

interface ProbeReport {
  results: ProbeRow[];
  skipped: { modelId: string; reason: string }[];
}

interface ConfigModel {
  id: string;
  displayName: string;
  tags: string[];
}

export function TestConnectionSheet({
  open,
  onOpenChange,
  orgSlug,
  providerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  providerName: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { data: providerData } = useReadProvider(orgSlug, providerName);
  const models: ConfigModel[] = providerData?.ok
    ? providerData.config.models
    : [];
  const testConnection = useTestProviderConnection();
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [running, setRunning] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);

  const runTest = useCallback(async () => {
    setRunning(true);
    setSystemError(null);
    try {
      const result = (await testConnection.mutateAsync({
        orgSlug,
        providerName,
      })) as ProbeReport;
      setReport(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSystemError(message);
      setReport(null);
    } finally {
      setRunning(false);
    }
  }, [orgSlug, providerName, testConnection]);

  // Auto-run on every open transition (covers both the detail-page case where
  // open toggles false → true and the providers-table case where the sheet is
  // mounted with open already true). The effect only depends on `open`; we
  // reach `runTest` through a ref because its identity changes whenever the
  // mutation state updates — depending on it directly would re-trigger the
  // effect after every probe finishes and loop forever.
  const runTestRef = useRef(runTest);
  runTestRef.current = runTest;
  useEffect(() => {
    if (!open) return;
    setReport(null);
    setSystemError(null);
    void runTestRef.current();
  }, [open]);

  const okCount = report?.results.filter((r) => r.ok).length ?? 0;
  const failCount = report ? report.results.length - okCount : 0;
  const totalProbed = report?.results.length ?? 0;
  const configLoading = !providerData;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.testDialogTitle')}
      size="md"
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('providers.testDialogTitle')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        {systemError ? (
          <HStack gap={2} align="start" className="text-destructive text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <Text className="text-sm">{systemError}</Text>
          </HStack>
        ) : configLoading ? (
          <Stack gap={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <HStack key={i} gap={3} align="center">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-48" />
              </HStack>
            ))}
          </Stack>
        ) : (
          <Stack gap={3}>
            {report ? (
              <Text className="text-muted-foreground text-sm">
                {t('providers.testSummary', {
                  ok: okCount,
                  total: totalProbed,
                  failed: failCount,
                })}
              </Text>
            ) : (
              <Text className="text-muted-foreground text-sm">
                {t('providers.testRunning')}
              </Text>
            )}

            <Stack gap={2}>
              {models.map((m) => {
                const result = report?.results.find((r) => r.modelId === m.id);
                const skipped = report?.skipped.find((s) => s.modelId === m.id);
                return (
                  <ProbeResultRow
                    key={m.id}
                    modelId={m.id}
                    displayName={m.displayName}
                    tags={m.tags}
                    running={running && !report}
                    result={result}
                    skipped={skipped != null}
                  />
                );
              })}
            </Stack>
          </Stack>
        )}
      </div>

      <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
        <HStack justify="end" align="center" gap={2}>
          <Button
            variant="secondary"
            type="button"
            onClick={runTest}
            disabled={running || configLoading}
          >
            {running ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('providers.testRunning')}
              </>
            ) : (
              t('providers.testRerun')
            )}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {tCommon('actions.close')}
          </Button>
        </HStack>
      </div>
    </Sheet>
  );
}

function ProbeResultRow({
  modelId,
  displayName,
  tags,
  running,
  result,
  skipped,
}: {
  modelId: string;
  displayName: string;
  tags: string[];
  running: boolean;
  result?: ProbeRow;
  skipped: boolean;
}) {
  const { t } = useT('settings');
  let icon: React.ReactNode;
  let detail: React.ReactNode;
  if (running) {
    icon = (
      <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
    );
    detail = (
      <Text className="text-muted-foreground text-xs">
        {t('providers.testRunning')}
      </Text>
    );
  } else if (skipped) {
    icon = <Minus className="text-muted-foreground size-4 shrink-0" />;
    detail = (
      <Text className="text-muted-foreground text-xs">
        {t('providers.testSkipped')}
      </Text>
    );
  } else if (result?.ok && result.warning) {
    icon = <CircleAlert className="size-4 shrink-0 text-yellow-600" />;
    detail = (
      <Text className="truncate text-xs text-yellow-700" title={result.warning}>
        {result.warning} ·{' '}
        {t('providers.testLatency', { latencyMs: result.latencyMs })}
      </Text>
    );
  } else if (result?.ok) {
    icon = <Check className="size-4 shrink-0 text-green-600" />;
    detail = (
      <Text className="text-muted-foreground text-xs">
        {t('providers.testLatency', { latencyMs: result.latencyMs })}
      </Text>
    );
  } else if (result) {
    icon = <X className="text-destructive size-4 shrink-0" />;
    const errorPrefix = result.status ? `${result.status} · ` : '';
    detail = (
      <Text
        className="text-destructive truncate text-xs"
        title={result.error ?? ''}
      >
        {errorPrefix}
        {result.error ?? t('providers.testKeyFailed')}
      </Text>
    );
  } else {
    icon = <Minus className="text-muted-foreground size-4 shrink-0" />;
    detail = null;
  }

  return (
    <HStack gap={3} align="center" className="min-w-0">
      {icon}
      <Stack gap={0} className="min-w-0 flex-1">
        <HStack gap={2} align="center" className="min-w-0">
          <Text className="truncate font-mono text-xs">{modelId}</Text>
          {tags.length > 0 && (
            <Badge variant="outline" className="shrink-0">
              {tags[0]}
            </Badge>
          )}
        </HStack>
        <Text className="text-muted-foreground truncate text-xs">
          {displayName}
        </Text>
        {detail}
      </Stack>
    </HStack>
  );
}

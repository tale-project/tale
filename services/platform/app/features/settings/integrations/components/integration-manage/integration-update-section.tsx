'use client';

import { AlertCircle, Code, Loader2, Upload, Zap } from 'lucide-react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ParsedPackage } from '../integration-upload/utils/parse-integration-package';

interface IntegrationUpdateSectionProps {
  parsedUpdate: ParsedPackage | null;
  isParsingUpdate: boolean;
  isApplyingUpdate: boolean;
  updateParseError: string | null;
  busy: boolean;
  onFilesSelected: (files: File[]) => void;
  onApplyUpdate: () => void;
  onClearUpdate: () => void;
}

export function IntegrationUpdateSection({
  parsedUpdate,
  isParsingUpdate,
  isApplyingUpdate,
  updateParseError,
  busy,
  onFilesSelected,
  onApplyUpdate,
  onClearUpdate,
}: IntegrationUpdateSectionProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  return (
    <CollapsibleDetails
      summary={
        <>
          <Upload className="size-4 shrink-0" />
          <span>{t('integrations.manageDialog.updateIntegration')}</span>
        </>
      }
    >
      <Stack gap={3} className="mt-2 ml-6">
        <Text variant="caption">
          {t('integrations.manageDialog.updateIntegrationDescription')}
        </Text>

        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={onFilesSelected}
            accept=".zip,.json,.js,.ts,.png,.svg,.jpg,.jpeg,.webp"
            multiple
            disabled={isParsingUpdate || isApplyingUpdate}
            inputId="integration-update-upload"
            aria-label={t('integrations.manageDialog.updateIntegration')}
            className={cn(
              'border-border hover:border-primary/50 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 transition-colors',
              (isParsingUpdate || isApplyingUpdate) &&
                'pointer-events-none opacity-50',
            )}
          >
            <Upload className="text-muted-foreground size-5" />
            <Stack gap={1} className="text-center">
              <Text variant="label-sm">
                {isParsingUpdate
                  ? t('integrations.upload.parsing')
                  : t('integrations.manageDialog.dropFilesToUpdate')}
              </Text>
              <Text variant="caption">
                {t('integrations.manageDialog.acceptedUpdateFormats')}
              </Text>
            </Stack>
          </FileUpload.DropZone>
          <FileUpload.Overlay label={t('integrations.upload.dropHere')} />
        </FileUpload.Root>

        {updateParseError && (
          <div
            className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
            role="alert"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <pre className="font-sans whitespace-pre-wrap">
              {updateParseError}
            </pre>
          </div>
        )}

        {parsedUpdate && (
          <Stack gap={3}>
            <Stack gap={2} className="bg-muted/50 rounded-lg p-3">
              <Text variant="label-sm">
                {t('integrations.manageDialog.updatePreview')}
              </Text>
              <HStack gap={3} className="text-muted-foreground text-xs">
                <HStack gap={1} className="items-center">
                  <Zap className="size-3" />
                  <span>
                    {t('integrations.manageDialog.newOperations', {
                      count: parsedUpdate.config.operations.length,
                    })}
                  </span>
                </HStack>
                {parsedUpdate.connectorCode.trim().length > 0 && (
                  <HStack gap={1} className="items-center">
                    <Code className="size-3" />
                    <span>
                      {t('integrations.manageDialog.newCodeLines', {
                        count: parsedUpdate.connectorCode.trim().split('\n')
                          .length,
                      })}
                    </span>
                  </HStack>
                )}
              </HStack>
            </Stack>

            <ActionRow gap={2}>
              <Button
                onClick={onApplyUpdate}
                disabled={busy}
                size="sm"
                className="flex-1"
              >
                {isApplyingUpdate ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('integrations.manageDialog.applyingUpdate')}
                  </>
                ) : (
                  t('integrations.manageDialog.applyUpdate')
                )}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onClearUpdate}
                disabled={busy}
              >
                {tCommon('actions.cancel')}
              </Button>
            </ActionRow>
          </Stack>
        )}
      </Stack>
    </CollapsibleDetails>
  );
}

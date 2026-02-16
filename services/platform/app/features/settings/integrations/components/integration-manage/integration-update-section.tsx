'use client';

import {
  AlertCircle,
  ChevronRight,
  Code,
  Loader2,
  Upload,
  Zap,
} from 'lucide-react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
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
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
        <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
        <Upload className="size-4 shrink-0" />
        <span>{t('integrations.manageDialog.updateIntegration')}</span>
      </summary>
      <Stack gap={3} className="mt-2 ml-6">
        <p className="text-muted-foreground text-xs">
          {t('integrations.manageDialog.updateIntegrationDescription')}
        </p>

        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={onFilesSelected}
            accept=".zip,.json,.js,.png,.svg,.jpg,.jpeg,.webp"
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
              <p className="text-xs font-medium">
                {isParsingUpdate
                  ? t('integrations.upload.parsing')
                  : t('integrations.manageDialog.dropFilesToUpdate')}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('integrations.manageDialog.acceptedUpdateFormats')}
              </p>
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
              <p className="text-xs font-medium">
                {t('integrations.manageDialog.updatePreview')}
              </p>
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

            <HStack gap={2}>
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
            </HStack>
          </Stack>
        )}
      </Stack>
    </details>
  );
}

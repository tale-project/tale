'use client';

import { useCallback, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useCreateIntegration } from '../../hooks/actions';
import { useGenerateUploadUrl } from '../../hooks/mutations';
import { useUploadIntegration } from './hooks/use-upload-integration';
import { PreviewStep } from './steps/preview-step';
import { UploadStep } from './steps/upload-step';

interface IntegrationUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function IntegrationUploadDialog({
  open,
  onOpenChange,
  organizationId,
}: IntegrationUploadDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const createIntegration = useCreateIntegration();
  const generateUploadUrl = useGenerateUploadUrl();

  const state = useUploadIntegration();

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        state.reset();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, state],
  );

  const handleCreate = useCallback(async () => {
    if (!state.parsedPackage) return;

    const { config, connectorCode, iconFile } = state.parsedPackage;
    state.setIsCreating(true);

    try {
      const isSql = config.type === 'sql';
      const authMethod =
        config.authMethod === 'bearer_token' ? 'api_key' : config.authMethod;
      const supportedAuthMethods = config.supportedAuthMethods?.map((m) =>
        m === 'bearer_token' ? 'api_key' : m,
      );

      // Upload icon to Convex storage if present
      let iconStorageId: string | undefined;
      if (iconFile) {
        const uploadUrl = await generateUploadUrl({});
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': iconFile.type || 'image/png' },
          body: iconFile,
        });
        if (!uploadResponse.ok) {
          throw new Error(t('integrations.upload.iconUploadFailed'));
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetch response.json() returns unknown
        const { storageId } = (await uploadResponse.json()) as {
          storageId: string;
        };
        iconStorageId = storageId;
      }

      // Build connector config
      const connector =
        !isSql && connectorCode.trim().length > 0
          ? {
              code: connectorCode,
              version: config.version ?? 1,
              operations: config.operations.map((op) => ({
                name: op.name,
                title: op.title,
                description: op.description,
                parametersSchema: op.parametersSchema,
                operationType: op.operationType,
                requiresApproval: op.requiresApproval,
              })),
              secretBindings: config.secretBindings,
              allowedHosts: config.allowedHosts,
              timeoutMs: config.connectionConfig?.timeout,
            }
          : undefined;

      const payload: Record<string, unknown> = {
        organizationId,
        name: config.name,
        title: config.title,
        description: config.description,
        authMethod,
        supportedAuthMethods,
        connectionConfig: config.connectionConfig ?? undefined,
        connector,
        type: isSql ? 'sql' : undefined,
        iconStorageId: iconStorageId
          ? toId<'_storage'>(iconStorageId)
          : undefined,
      };

      if (config.oauth2Config) {
        payload.oauth2Config = config.oauth2Config;
      }

      if (isSql && config.sqlConnectionConfig) {
        payload.sqlConnectionConfig = config.sqlConnectionConfig;
      }

      if (isSql) {
        const sqlOps = config.operations
          .filter((op) => op.query)
          .map((op) => ({
            name: op.name,
            title: op.title,
            description: op.description,
            query: op.query,
            parametersSchema: op.parametersSchema,
            operationType: op.operationType,
            requiresApproval: op.requiresApproval,
          }));
        if (sqlOps.length > 0) {
          payload.sqlOperations = sqlOps;
        }
      }

      await createIntegration(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic payload for create action
        payload as Parameters<typeof createIntegration>[0],
      );

      toast({
        title: t('integrations.upload.createSuccess'),
        description: t('integrations.upload.configureCredentialsHint'),
        variant: 'success',
      });
      handleOpenChange(false);
    } catch (error) {
      toast({
        title: t('integrations.upload.createFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.upload.unexpectedError'),
        variant: 'destructive',
      });
    } finally {
      state.setIsCreating(false);
    }
  }, [
    state,
    organizationId,
    createIntegration,
    generateUploadUrl,
    handleOpenChange,
    t,
  ]);

  const stepTitles = useMemo(
    () => [
      t('integrations.upload.stepUpload'),
      t('integrations.upload.stepPreview'),
    ],
    [t],
  );

  const footer = (
    <>
      {state.step === 'upload' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => handleOpenChange(false)}
        >
          {tCommon('actions.cancel')}
        </Button>
      )}

      {state.step === 'preview' && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={state.goBack}
            disabled={state.isCreating}
          >
            {tCommon('actions.back')}
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={state.isCreating}
          >
            {state.isCreating
              ? t('integrations.upload.creating')
              : t('integrations.upload.createIntegration')}
          </Button>
        </>
      )}
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('integrations.upload.title')}
      description={t('integrations.upload.description')}
      size="xl"
      footer={footer}
      className="max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        {/* Step indicator */}
        <nav aria-label={t('integrations.upload.steps')}>
          <ol className="flex items-center justify-center gap-1.5">
            {stepTitles.map((title, i) => (
              <li
                key={title}
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  i === state.stepIndex ? 'bg-foreground' : 'bg-foreground/20',
                )}
                aria-current={i === state.stepIndex ? 'step' : undefined}
                aria-label={title}
              />
            ))}
          </ol>
        </nav>

        {/* Scrollable content area */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
          {state.step === 'upload' && (
            <UploadStep onPackageParsed={state.setParsedPackage} />
          )}

          {state.step === 'preview' && state.parsedPackage && (
            <PreviewStep
              parsedPackage={state.parsedPackage}
              onIconChange={state.setIconFile}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

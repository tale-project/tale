'use client';

import { useAction } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useUploadIntegration } from './hooks/use-upload-integration';
import { PreviewStep } from './steps/preview-step';
import { TemplateStep } from './steps/template-step';
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
  const writeFilesFn = useAction(
    api.integrations.file_actions.writeIntegrationFiles,
  );
  const installFn = useAction(api.integrations.file_actions.installIntegration);

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

    const { config, connectorCode } = state.parsedPackage;
    state.setIsCreating(true);

    try {
      const slug = config.name;

      await writeFilesFn({
        orgSlug: 'default',
        slug,
        config,
        connectorCode:
          connectorCode.trim().length > 0 ? connectorCode : undefined,
      });

      await installFn({ orgSlug: 'default', slug, organizationId });

      window.dispatchEvent(new Event('integration-updated'));

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
  }, [state, writeFilesFn, installFn, handleOpenChange, organizationId, t]);

  const tabItems = useMemo(
    () => [
      {
        value: 'upload' as const,
        label: t('integrations.upload.tabUpload'),
      },
      {
        value: 'template' as const,
        label: t('integrations.upload.tabTemplate'),
      },
    ],
    [t],
  );

  const footer = (
    <>
      {state.step === 'upload' && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleOpenChange(false)}
        >
          {tCommon('actions.cancel')}
        </Button>
      )}

      {state.step === 'preview' && (
        <>
          <Button
            type="button"
            variant="secondary"
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
      title={t('integrations.upload.addDialogTitle')}
      size="xl"
      footer={footer}
      className="max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        {/* Step 1: Tab selection (Upload / Template) */}
        {state.step === 'upload' && (
          <>
            <Tabs
              items={tabItems}
              value={state.activeTab}
              onValueChange={(v) => {
                if (v === 'upload' || v === 'template') {
                  state.setActiveTab(v);
                }
              }}
              listClassName="grid w-full grid-cols-2"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
              {state.activeTab === 'upload' && (
                <UploadStep onPackageParsed={state.setParsedPackage} />
              )}
              {state.activeTab === 'template' && (
                <TemplateStep onPackageParsed={state.setParsedPackage} />
              )}
            </div>
          </>
        )}

        {/* Step 2: Preview */}
        {state.step === 'preview' && state.parsedPackage && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
            <PreviewStep
              parsedPackage={state.parsedPackage}
              onIconChange={state.setIconFile}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

'use client';

import { Loader2, Puzzle, Upload } from 'lucide-react';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Center, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

interface IntegrationIconUploadProps {
  iconUrl: string | null | undefined;
  title: string;
  isUploadingIcon: boolean;
  isActive: boolean;
  isSql: boolean;
  authMethod: string;
  operationCount: number;
  iconInputRef: React.RefObject<HTMLInputElement | null>;
  onIconUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function IntegrationIconUpload({
  iconUrl,
  title,
  isUploadingIcon,
  isActive,
  isSql,
  authMethod,
  operationCount,
  iconInputRef,
  onIconUpload,
}: IntegrationIconUploadProps) {
  const { t } = useT('settings');

  return (
    <HStack gap={3} className="items-center">
      <button
        type="button"
        className="group relative shrink-0"
        onClick={() => iconInputRef.current?.click()}
        disabled={isUploadingIcon}
        aria-label={t('integrations.upload.changeIcon')}
      >
        <Center className="border-border group-hover:border-primary/50 size-10 rounded-md border transition-colors">
          {isUploadingIcon ? (
            <Loader2 className="size-4 animate-spin" />
          ) : iconUrl ? (
            <Image
              src={iconUrl}
              alt={title}
              className="size-5 rounded object-contain"
            />
          ) : (
            <Puzzle className="size-5" />
          )}
        </Center>
        <span className="bg-background border-border absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border shadow-sm">
          <Upload className="size-2" />
        </span>
      </button>
      <input
        ref={iconInputRef}
        type="file"
        accept=".png,.svg,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={onIconUpload}
        aria-label={t('integrations.upload.changeIcon')}
      />
      <StatusIndicator variant={isActive ? 'success' : 'warning'}>
        {isActive
          ? t('integrations.upload.active')
          : t('integrations.upload.inactive')}
      </StatusIndicator>
      {operationCount > 0 && (
        <HStack gap={2} className="ml-auto flex-wrap">
          <Badge variant="outline" className="text-xs">
            {operationCount} {t('integrations.upload.operations').toLowerCase()}
          </Badge>
          {isSql && (
            <Badge variant="outline" className="text-xs">
              SQL
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {authMethod}
          </Badge>
        </HStack>
      )}
    </HStack>
  );
}

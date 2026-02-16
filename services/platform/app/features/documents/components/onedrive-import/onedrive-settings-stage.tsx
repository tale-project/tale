'use client';

import { Database, Loader2, Users } from 'lucide-react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import type { ImportType } from './types';

interface OneDriveSettingsStageProps {
  selectedItemCount: number;
  importType: ImportType;
  isImporting: boolean;
  teams: Array<{ id: string; name: string }> | undefined;
  isLoadingTeams: boolean;
  selectedTeams: Set<string>;
  onImportTypeChange: (type: ImportType) => void;
  onToggleTeam: (teamId: string) => void;
  onBack: () => void;
  onImport: () => void;
}

export function OneDriveSettingsStage({
  selectedItemCount,
  importType,
  isImporting,
  teams,
  isLoadingTeams,
  selectedTeams,
  onImportTypeChange,
  onToggleTeam,
  onBack,
  onImport,
}: OneDriveSettingsStageProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');

  const footer = (
    <HStack gap={4} className="w-full justify-stretch">
      <Button
        variant="secondary"
        onClick={onBack}
        className="flex-1"
        disabled={isImporting}
      >
        {tCommon('actions.back')}
      </Button>
      <Button onClick={onImport} className="flex-1" disabled={isImporting}>
        {isImporting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {importType === 'one-time'
              ? t('onedrive.importing')
              : t('onedrive.syncing')}
          </>
        ) : (
          <>
            <Database className="mr-2 size-4" />
            {importType === 'one-time'
              ? t('onedrive.importItems', { count: selectedItemCount })
              : t('onedrive.syncItems', { count: selectedItemCount })}
          </>
        )}
      </Button>
    </HStack>
  );

  return {
    title: t('onedrive.importSettings'),
    description: t('onedrive.settingsDescription', {
      count: selectedItemCount,
    }),
    footer,
    footerClassName: 'border-t border-border p-4',
    customHeader: (
      <div className="border-border flex items-start justify-between border-b px-6 py-5">
        <div className="space-y-1">
          <h2 className="text-foreground text-base leading-none font-semibold tracking-tight">
            {t('onedrive.importSettings')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('onedrive.settingsDescription', {
              count: selectedItemCount,
            })}
          </p>
        </div>
      </div>
    ),
    content: (
      <div className="px-6 py-2">
        <RadioGroup
          value={importType}
          onValueChange={(value: string) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Radix RadioGroup onValueChange returns string
            onImportTypeChange(value as ImportType)
          }
          className="space-y-2"
        >
          <div className="border-border hover:bg-muted rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="one-time" id="one-time" />
              <div className="flex-1">
                <label
                  htmlFor="one-time"
                  className="cursor-pointer text-base font-medium"
                >
                  {t('onedrive.oneTimeImport')}
                </label>
                <div className="text-muted-foreground text-sm">
                  {t('onedrive.oneTimeDescription')}
                </div>
              </div>
            </div>
          </div>

          <div className="border-border hover:bg-muted rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="sync" id="sync" />
              <div className="flex-1">
                <label
                  htmlFor="sync"
                  className="cursor-pointer text-base font-medium"
                >
                  {t('onedrive.syncImport')}
                </label>
                <div className="text-muted-foreground text-sm">
                  {t('onedrive.syncDescription')}
                </div>
              </div>
            </div>
          </div>
        </RadioGroup>

        <div className="border-border mt-4 border-t pt-4">
          <p className="mb-2 text-sm font-medium">{t('upload.selectTeams')}</p>
          <p className="text-muted-foreground mb-3 text-xs">
            {t('upload.selectTeamsDescription')}
          </p>

          {isLoadingTeams ? (
            <div className="flex items-center justify-center py-4">
              <span className="text-muted-foreground text-sm">
                {tCommon('actions.loading')}
              </span>
            </div>
          ) : !teams || teams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <Users className="text-muted-foreground/50 mb-2 size-6" />
              <p className="text-muted-foreground text-sm">
                {t('upload.noTeamsAvailable')}
              </p>
            </div>
          ) : (
            <Stack gap={2}>
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                >
                  <Checkbox
                    id={`onedrive-team-${team.id}`}
                    checked={selectedTeams.has(team.id)}
                    onCheckedChange={() => onToggleTeam(team.id)}
                    disabled={isImporting}
                    label={team.name}
                  />
                </div>
              ))}
            </Stack>
          )}

          <p className="text-muted-foreground mt-3 text-xs">
            {t('upload.allMembersHint')}
          </p>
        </div>
      </div>
    ),
  };
}

'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Pencil, Plus } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { type ModerationCategoryMapping } from '@/lib/shared/schemas/governance';

interface MappingListProps {
  mappings: readonly ModerationCategoryMapping[];
  disabled: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
}

export function MappingList({
  mappings,
  disabled,
  onAdd,
  onEdit,
}: MappingListProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  return (
    <Stack gap={2}>
      {mappings.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t('moderationProvider.mappingsEmpty')}
        </div>
      ) : (
        <Table>
          <TableCaption className="sr-only">
            {t('moderationProvider.categoryMappings')}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t('moderationProvider.mappingColumnProviderCategory')}
              </TableHead>
              <TableHead>
                {t('moderationProvider.mappingColumnInternalLabel')}
              </TableHead>
              <TableHead>{t('moderationProvider.mappingColumnMode')}</TableHead>
              <TableHead>
                {t('moderationProvider.mappingColumnThreshold')}
              </TableHead>
              <TableHead>
                {t('moderationProvider.mappingColumnEnabled')}
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping, index) => (
              <TableRow key={index}>
                <TableCell className="font-mono text-xs">
                  {mapping.providerCategory}
                </TableCell>
                <TableCell>{mapping.internalLabel}</TableCell>
                <TableCell className="capitalize">{mapping.mode}</TableCell>
                <TableCell>
                  {mapping.scoreThreshold ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {mapping.enabled
                    ? t('moderationProvider.yes')
                    : t('moderationProvider.no')}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    disabled={disabled}
                    onClick={() => onEdit(index)}
                  >
                    {tCommon('actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={onAdd}
        >
          {t('moderationProvider.addMapping')}
        </Button>
      </div>
    </Stack>
  );
}

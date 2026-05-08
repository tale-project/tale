'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useBulkPlaceLegalHold } from '../hooks/mutations';
import { useLegalMatters } from '../hooks/queries';
import { mapLegalHoldError } from './legal-hold-errors';

const TARGET_TYPES = [
  'thread',
  'document',
  'execution',
  'userMembership',
  'org',
] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const ENTRY_REGEX = /^([a-zA-Z]+):(.+)$/;
const MAX_ENTRIES = 200;

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

interface BulkPlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

interface FormValues {
  entriesText: string;
  reason: string;
  matterRef: string;
}

type ParsedEntry =
  | { ok: true; raw: string; targetType: TargetType; targetId: string }
  | { ok: false; raw: string; error: string };

interface BulkResult {
  placed: number;
  skipped: Array<{ targetType: string; targetId: string; reason: string }>;
}

function parseEntries(
  text: string,
  t: ReturnType<typeof useT>['t'],
): ParsedEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map<ParsedEntry>((raw) => {
      const match = ENTRY_REGEX.exec(raw);
      if (!match) {
        return {
          ok: false,
          raw,
          error: t('legalHold.dialogs.bulkPlace.invalidLine'),
        };
      }
      const candidateType = match[1];
      const targetId = match[2].trim();
      if (!isTargetType(candidateType) || targetId.length === 0) {
        return {
          ok: false,
          raw,
          error: t('legalHold.dialogs.bulkPlace.invalidLine'),
        };
      }
      return { ok: true, raw, targetType: candidateType, targetId };
    });
}

export function BulkPlaceDialog({
  open,
  onOpenChange,
  organizationId,
}: BulkPlaceDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useBulkPlaceLegalHold();
  const matters = useLegalMatters(organizationId, { status: 'open' });
  const [result, setResult] = useState<BulkResult | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const matterOptions = useMemo(
    () =>
      (matters.data ?? []).map((m) => ({
        value: String(m._id),
        label: m.name,
        description: m.caseNumber,
      })),
    [matters.data],
  );

  const schema = useMemo(
    () =>
      z.object({
        entriesText: z.string().min(1),
        reason: z
          .string()
          .trim()
          .min(1, t('legalHold.errors.validation'))
          .max(2000),
        matterRef: z.string(),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { entriesText: '', reason: '', matterRef: '' },
  });
  const { register, handleSubmit, formState, watch, setValue, reset } = form;
  const entriesText = watch('entriesText');
  const matterRef = watch('matterRef');

  const parsed = useMemo(() => parseEntries(entriesText, t), [entriesText, t]);
  const validEntries = useMemo(
    () => parsed.filter((p): p is Extract<ParsedEntry, { ok: true }> => p.ok),
    [parsed],
  );
  const invalidEntries = useMemo(
    () => parsed.filter((p): p is Extract<ParsedEntry, { ok: false }> => !p.ok),
    [parsed],
  );
  const tooMany = parsed.length > MAX_ENTRIES;

  const onSubmit = handleSubmit(async (values) => {
    if (validEntries.length === 0 || invalidEntries.length > 0 || tooMany) {
      return;
    }
    try {
      const res = await mutateAsync({
        organizationId,
        holds: validEntries.map((e) => ({
          targetType: e.targetType,
          targetId: e.targetId,
          reason: values.reason.trim(),
          matterRef: values.matterRef ? values.matterRef : undefined,
        })),
      });
      setResult(res);
      toast({
        title: t('legalHold.toasts.bulkPlacedTitle'),
        description: t('legalHold.toasts.bulkPlacedDescription', {
          placed: res.placed,
          skipped: res.skipped.length,
        }),
        variant: 'success',
      });
    } catch (err) {
      const mapped = mapLegalHoldError(err, t);
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setResult(null);
      setShowSkipped(false);
    }
    onOpenChange(next);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('legalHold.dialogs.bulkPlace.title')}
      description={t('legalHold.dialogs.bulkPlace.description')}
      isSubmitting={isPending}
      isValid={
        formState.isValid &&
        validEntries.length > 0 &&
        invalidEntries.length === 0 &&
        !tooMany
      }
      onSubmit={onSubmit}
      submitText={t('legalHold.dialogs.bulkPlace.submit', {
        count: validEntries.length,
      })}
      large
    >
      {result ? (
        <FormSection>
          <Text>
            {t('legalHold.dialogs.bulkPlace.summaryPlaced', {
              count: result.placed,
            })}{' '}
            {t('legalHold.dialogs.bulkPlace.summarySkipped', {
              count: result.skipped.length,
            })}
          </Text>
          {result.skipped.length > 0 && (
            <>
              <button
                type="button"
                className="text-primary text-left text-sm underline"
                onClick={() => setShowSkipped((v) => !v)}
              >
                {t('legalHold.dialogs.bulkPlace.showSkipped')}
              </button>
              {showSkipped && (
                <ul className="text-muted-foreground space-y-1 text-xs">
                  {result.skipped.map((s, i) => (
                    <li key={`${s.targetType}:${s.targetId}:${i}`}>
                      <span className="font-mono">
                        {s.targetType}:{s.targetId}
                      </span>{' '}
                      — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </FormSection>
      ) : (
        <FormSection>
          <Textarea
            id="bulk-entries"
            rows={8}
            label={t('legalHold.dialogs.bulkPlace.entriesLabel')}
            placeholder={t('legalHold.dialogs.bulkPlace.entriesPlaceholder')}
            required
            {...register('entriesText')}
            errorMessage={
              tooMany
                ? t('legalHold.dialogs.bulkPlace.tooManyEntries')
                : undefined
            }
          />
          {invalidEntries.length > 0 && (
            <ul className="text-destructive space-y-0.5 text-xs">
              {invalidEntries.slice(0, 5).map((e, i) => (
                <li key={`${e.raw}:${i}`}>
                  <span className="font-mono">{e.raw}</span> — {e.error}
                </li>
              ))}
            </ul>
          )}
          {validEntries.length > 0 && (
            <Text variant="muted" className="text-xs">
              {t('legalHold.dialogs.bulkPlace.previewValid')}:{' '}
              {validEntries.length}
              {invalidEntries.length > 0
                ? ` · ${t('legalHold.dialogs.bulkPlace.previewInvalid')}: ${invalidEntries.length}`
                : ''}
            </Text>
          )}
          <Textarea
            id="bulk-reason"
            rows={2}
            label={t('legalHold.dialogs.bulkPlace.reasonLabel')}
            required
            {...register('reason')}
            errorMessage={formState.errors.reason?.message}
          />
          <SearchableSelect
            id="bulk-matter"
            label={t('legalHold.dialogs.bulkPlace.matterLabel')}
            value={matterRef || null}
            onValueChange={(value) =>
              setValue('matterRef', value, { shouldDirty: true })
            }
            options={matterOptions}
          />
        </FormSection>
      )}
    </FormDialog>
  );
}

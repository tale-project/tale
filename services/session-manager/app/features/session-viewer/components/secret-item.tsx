import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCopy } from '@tale/ui/use-copy';
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { useSecret } from '@/app/features/secrets/hooks/use-secret';
import { useSecretLabels } from '@/app/features/secrets/hooks/use-secret-labels';
import { KIND_ICONS } from '@/app/features/secrets/lib/kinds';
import { readFailureText } from '@/app/lib/api/failure';
import type { SecretField, SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { splitLines } from '../lib/group-secrets';
import { TOUCH_TARGET } from '../lib/touch';

/**
 * The fill of a mark or a value inside the popover: light gray on its white
 * surface, and near black on its gray one in the dark theme, where the usual
 * muted fill is the surface's own colour and would vanish into it.
 */
const INSET = 'bg-muted dark:bg-background';

/** The mark of a secret's kind: the one of the Secrets page's list, as decoration. */
function KindMark({ kind }: { kind: SecretSummary['kind'] }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      aria-hidden="true"
      className={cn(
        INSET,
        'text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded [&_svg]:size-3',
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}

/**
 * One secret of the list: its kind, its title, whose it is and what it holds
 * in a line, and a chevron. It opens to its values, which are read only then.
 * The button is named by the title; the rest is its description, so that a
 * screen reader says the name first and the detail after.
 */
export function SecretItem({
  secret,
  onType,
}: {
  secret: SecretSummary;
  onType: (text: string) => void;
}) {
  const { t } = useT('viewer');
  const [open, setOpen] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;
  const scopeId = `${id}-scope`;
  const previewId = `${id}-preview`;
  const valuesId = `${id}-values`;

  return (
    <li>
      <button
        type="button"
        data-secret-row=""
        aria-expanded={open}
        aria-controls={open ? valuesId : undefined}
        aria-labelledby={titleId}
        aria-describedby={secret.preview ? `${scopeId} ${previewId}` : scopeId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'hover:bg-accent focus-visible:ring-ring flex w-full scroll-mt-8 items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none',
          TOUCH_TARGET,
        )}
      >
        <KindMark kind={secret.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              id={titleId}
              title={secret.title}
              className="min-w-0 flex-1 truncate text-sm leading-5 font-medium"
            >
              {secret.title}
            </span>
            {/* Plain words, not a control: it only says whose the secret is. */}
            <span
              id={scopeId}
              className="text-muted-foreground shrink-0 text-xs leading-5"
            >
              {secret.session ? t('secrets.forThis') : t('secrets.forEvery')}
            </span>
          </span>
          {secret.preview && (
            <span
              id={previewId}
              title={secret.preview}
              className="text-muted-foreground truncate text-xs leading-4"
            >
              {secret.preview}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 self-center transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <SecretValues
          id={secret.id}
          regionId={valuesId}
          labelledBy={titleId}
          onType={onType}
        />
      )}
    </li>
  );
}

function SecretValues({
  id,
  regionId,
  labelledBy,
  onType,
}: {
  id: number;
  regionId: string;
  labelledBy: string;
  onType: (text: string) => void;
}) {
  const { t } = useT('viewer');
  const { t: tErrors } = useT('errors');
  const values = useSecret(id);
  const region = useRef<HTMLDivElement>(null);
  const loaded = !values.isPending;
  // A secret opened near the foot of a list that scrolls shows its values, not
  // only its row: when they are there, the list moves as far as it takes.
  useEffect(() => {
    if (loaded) region.current?.scrollIntoView({ block: 'nearest' });
  }, [loaded]);

  return (
    // In the column of the titles, under the mark of the kind.
    <div
      ref={region}
      id={regionId}
      role="group"
      aria-labelledby={labelledBy}
      className="pr-2 pb-1.5 pl-10"
    >
      {values.isPending && (
        <Skeletonize loading label={t('secrets.loading')} className="py-1">
          <SkeletonBox>
            <span className="inline-block h-3 w-16" />
          </SkeletonBox>
          <SkeletonBox fullWidth className="mt-1">
            <span className="block h-8 w-full" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {values.isError && (
        <div className="py-1">
          <CatalogLoadError
            message={readFailureText(
              t('secrets.valuesFailed'),
              values.error,
              tErrors,
            )}
            onRetry={() => void values.refetch()}
            isRetrying={values.isFetching}
          />
        </div>
      )}
      {values.data?.fields.map((field, position) => (
        <SecretValue
          key={`${position}:${field.label}`}
          field={field}
          onType={onType}
        />
      ))}
    </div>
  );
}

/**
 * One value of an opened secret: its label, the value (dots while it is
 * masked), and what can be done with it, in a row that reads the same whatever
 * the value is. A value of several lines shows its first, and says how many
 * more it has: the whole of it is what is typed and copied.
 */
function SecretValue({
  field,
  onType,
}: {
  field: SecretField;
  onType: (text: string) => void;
}) {
  const { t } = useT('viewer');
  const labels = useSecretLabels();
  const [shown, setShown] = useState(false);
  const { copied, copy } = useCopy();
  // The server words the starting fields in English only: the person reads their own language.
  const label = labels.field(field.label);
  const masked = field.hidden && !shown;
  const empty = field.value === '';
  const { first, more } = splitLines(field.value);

  return (
    <div className="py-1">
      <div className="text-muted-foreground text-xs leading-4">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <div
          // What is cut short can be read whole by a pointer that rests on it,
          // never when it is masked.
          title={masked || empty ? undefined : field.value}
          className={cn(
            INSET,
            'flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 font-mono text-xs',
          )}
        >
          {empty ? (
            <span className="text-muted-foreground font-sans">
              {t('secrets.emptyValue')}
            </span>
          ) : masked ? (
            <>
              <span aria-hidden="true">••••••••</span>
              <span className="sr-only">{t('secrets.maskedValue')}</span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate">{first}</span>
              {more > 0 && (
                <span className="text-muted-foreground shrink-0 font-sans">
                  {t('secrets.moreLines', { count: more })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {field.hidden && !empty && (
            <IconButton
              icon={shown ? EyeOff : Eye}
              size="sm"
              aria-label={t('secrets.show', { label })}
              aria-pressed={shown}
              onClick={() => setShown((current) => !current)}
            />
          )}
          <IconButton
            icon={copied ? Check : Copy}
            size="sm"
            aria-label={t('secrets.copy', { label })}
            disabled={empty}
            onClick={() => void copy(field.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('secrets.typeLabel', { label })}
            disabled={empty}
            onClick={() => onType(field.value)}
          >
            {t('secrets.type')}
          </Button>
        </div>
      </div>
    </div>
  );
}

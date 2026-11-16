'use client';

import { Check, CircleCheck, Copy, Download, Maximize2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { inferSchema, type SchemaTreeSchema } from '../../../data/infer-schema';
import { useSwapFade } from '../../../hooks/use-swap-fade';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { formatBytes } from '../../../lib/format';
import { IssueSeverityIcon } from '../../feedback/issue-severity';
import { SegmentedControl } from '../../forms/segmented-control';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '../../overlays/responsive-dialog';
import { Button } from '../../primitives/button';
import {
  ValueTree,
  type ValueElision,
  type ValueMarks,
} from '../value-tree/value-tree';
import { compareShape } from './shape-compare';
import { ShapeView } from './shape-view';

export { ShapeView, type ShapeViewProps } from './shape-view';
export {
  compareShape,
  shapePathKey,
  type ShapeComparison,
  type ShapeMark,
} from './shape-compare';

export type DataViewMode = 'values' | 'shape';

export interface DataViewProps {
  /** `undefined` shows `empty`: nothing was recorded. */
  value: unknown;
  /** What the recorder left out (`RecordedValue`), and the value's size. */
  recorded?: {
    elided?: readonly ValueElision[];
    redacted?: readonly string[];
    bytes?: number;
  };
  'aria-label': string;
  /** Controlled mode, when several views share one switch. */
  mode?: DataViewMode;
  onModeChange?: (mode: DataViewMode) => void;
  /** The Values / Shape switch: shown. */
  showModeSwitch?: boolean;
  /** The shape the value should have: a verdict line in Values, marks in
   *  Shape. */
  expected?: SchemaTreeSchema | null;
  /** Where the expected shape comes from: "From the analysis of v4". */
  expectedLabel?: string;
  /** Copy JSON (on), Download JSON (off) and Open full screen (off). */
  toolbar?: {
    copy?: boolean;
    download?: { fileName: string } | false;
    fullScreen?: boolean | { title: string };
  };
  /** Instead of "Nothing recorded". */
  empty?: ReactNode;
  marks?: ValueMarks;
  density?: 'compact' | 'comfortable';
  className?: string;
}

/** The value as the JSON a reader copies or downloads: what was recorded,
 *  hidden secrets still hidden. */
function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch (error) {
    console.warn('A data view could not write its value as JSON', error);
    return '';
  }
}

function downloadJson(fileName: string, json: string): void {
  const url = URL.createObjectURL(
    new Blob([json], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * One recorded value, read two ways: **Values**, a `ValueTree` of the value
 * with what the recorder left out shown as chips, and **Shape**, the fields
 * it has (`ShapeView`). Against an `expected` shape it says whether the
 * value matches, and Shape marks what differs. A toolbar copies the value as
 * JSON, downloads it, and opens it full screen.
 */
export function DataView(props: DataViewProps) {
  const {
    mode: controlledMode,
    onModeChange,
    toolbar,
    'aria-label': ariaLabel,
  } = props;
  const { t } = useT('dataView');
  const [ownMode, setOwnMode] = useState<DataViewMode>('values');
  const mode = controlledMode ?? ownMode;
  const setMode = useCallback(
    (next: DataViewMode) => {
      setOwnMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenTitle =
    typeof toolbar?.fullScreen === 'object'
      ? toolbar.fullScreen.title
      : ariaLabel;
  return (
    <>
      <DataViewBody
        {...props}
        mode={mode}
        onModeChange={setMode}
        onOpenFullScreen={
          toolbar?.fullScreen ? () => setFullScreen(true) : undefined
        }
      />
      {toolbar?.fullScreen ? (
        <ResponsiveDialog open={fullScreen} onOpenChange={setFullScreen}>
          <ResponsiveDialogContent
            closeLabel={t('closeFullScreen')}
            className="max-w-[min(95vw,72rem)] md:w-[95vw]"
          >
            <ResponsiveDialogTitle className="pr-10 text-base font-semibold">
              {fullScreenTitle}
            </ResponsiveDialogTitle>
            <DataViewBody
              {...props}
              mode={mode}
              onModeChange={setMode}
              density="comfortable"
              className={undefined}
            />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
    </>
  );
}

function DataViewBody({
  value,
  recorded,
  'aria-label': ariaLabel,
  mode,
  onModeChange,
  showModeSwitch = true,
  expected,
  expectedLabel,
  toolbar,
  empty,
  marks,
  density = 'comfortable',
  className,
  onOpenFullScreen,
}: DataViewProps & {
  mode: DataViewMode;
  onModeChange: (mode: DataViewMode) => void;
  onOpenFullScreen?: () => void;
}) {
  const { t } = useT('dataView');
  const { t: tCommon } = useT('common');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const swapRef = useSwapFade<HTMLDivElement>(mode);
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  const copyTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const verdict = useMemo(() => {
    if (expected === undefined || expected === null || value === undefined) {
      return null;
    }
    return compareShape(expected, inferSchema(value)).differing;
  }, [expected, value]);

  if (value === undefined) {
    return (
      <p className={cn('text-muted-foreground text-sm', className)}>
        {empty ?? t('empty')}
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jsonOf(value));
      setCopied(true);
      setAnnouncement((previous) => ({
        text: tCommon('actions.copied'),
        count: previous.count + 1,
      }));
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn('A data view could not copy to the clipboard', error);
    }
  };

  const showCopy = toolbar?.copy ?? true;
  const download = toolbar?.download;
  const hasToolbar =
    showCopy ||
    (download !== undefined && download !== false) ||
    onOpenFullScreen !== undefined;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      {showModeSwitch || hasToolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {showModeSwitch ? (
            <SegmentedControl
              aria-label={t('modeLabel')}
              value={mode}
              onValueChange={(next) =>
                onModeChange(next === 'shape' ? 'shape' : 'values')
              }
              options={[
                { value: 'values', label: t('values') },
                { value: 'shape', label: t('shape') },
              ]}
            />
          ) : null}
          {hasToolbar ? (
            <div className="ml-auto flex items-center gap-0.5">
              {showCopy ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('copy')}
                  onClick={() => void copy()}
                >
                  {copied ? (
                    <Check aria-hidden="true" className="text-success size-4" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )}
                </Button>
              ) : null}
              {download !== undefined && download !== false ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('download')}
                  onClick={() => downloadJson(download.fileName, jsonOf(value))}
                >
                  <Download aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
              {onOpenFullScreen !== undefined ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('fullScreen')}
                  onClick={onOpenFullScreen}
                >
                  <Maximize2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {verdict !== null ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {verdict === 0 ? (
            <>
              <CircleCheck
                aria-hidden="true"
                className="text-success size-3.5 shrink-0"
              />
              <span>{t('expected.matches')}</span>
            </>
          ) : (
            <>
              <IssueSeverityIcon severity="warning" className="size-3.5" />
              <span>{t('expected.differs', { count: verdict })}</span>
              {mode === 'values' ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto py-0 text-xs underline underline-offset-2"
                  onClick={() => onModeChange('shape')}
                >
                  {t('expected.compare')}
                </Button>
              ) : null}
            </>
          )}
          {expectedLabel !== undefined ? (
            <span className="text-muted-foreground">· {expectedLabel}</span>
          ) : null}
        </p>
      ) : null}
      <div ref={swapRef} className="min-w-0">
        {mode === 'values' ? (
          <ValueTree
            value={value}
            aria-label={ariaLabel}
            elided={recorded?.elided}
            redacted={recorded?.redacted}
            marks={marks}
            density={density}
          />
        ) : (
          <ShapeView
            value={value}
            expected={expected}
            aria-label={ariaLabel}
            density={density}
          />
        )}
      </div>
      {recorded?.bytes !== undefined ? (
        <p className="text-muted-foreground text-xs">
          {t('size', { size: formatBytes(recorded.bytes, locale) })}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        <span key={announcement.count}>{announcement.text}</span>
      </p>
    </div>
  );
}

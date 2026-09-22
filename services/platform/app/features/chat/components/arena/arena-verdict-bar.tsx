'use client';

/**
 * The verdict controls under the split view: four verdicts plus an exit
 * without one. A `role="group"` with a visible label — the four choices are
 * one decision, and assistive technology should hear them as such. Disabled
 * while either column is still answering: a verdict about a reply mid-flight
 * would rate an unfinished answer. The four verdicts alone wait while a
 * column has no finished reply to this round (a side that failed or never
 * started) — the hint says so, and the exit stays open.
 */

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import type { ArenaVerdict } from '@/lib/shared/arena';

interface ArenaVerdictBarProps {
  /** A column is still generating — the verdict waits for both answers. */
  disabled: boolean;
  /** A column has no finished reply to rate — the verdicts wait, the exit
   * does not. */
  verdictDisabled?: boolean;
  /** Why the verdicts wait, shown beside the label. */
  hint?: string;
  onVerdict: (verdict: ArenaVerdict) => void;
  onExit: () => void;
}

const VERDICT_KEYS: ReadonlyArray<{
  verdict: ArenaVerdict;
  labelKey: string;
}> = [
  { verdict: 'a_better', labelKey: 'arena.aBetter' },
  { verdict: 'b_better', labelKey: 'arena.bBetter' },
  { verdict: 'tie', labelKey: 'arena.tie' },
  { verdict: 'both_bad', labelKey: 'arena.bothBad' },
];

export function ArenaVerdictBar({
  disabled,
  verdictDisabled = false,
  hint,
  onVerdict,
  onExit,
}: ArenaVerdictBarProps) {
  const { t } = useT('chat');

  return (
    <div
      role="group"
      aria-label={t('arena.verdictLabel')}
      data-testid="arena-verdict-bar"
      className="border-border bg-background/95 flex shrink-0 flex-wrap items-center justify-center gap-2 border-t px-4 py-3"
    >
      <Text variant="muted" className="mr-1 text-sm">
        {t('arena.verdictLabel')}
      </Text>
      <Row gap={2} className="flex-wrap justify-center">
        {VERDICT_KEYS.map(({ verdict, labelKey }) => (
          <Button
            key={verdict}
            size="sm"
            variant="secondary"
            disabled={disabled || verdictDisabled}
            data-testid={`arena-verdict-${verdict}`}
            onClick={() => onVerdict(verdict)}
          >
            {t(labelKey)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onExit}
          className="text-muted-foreground"
        >
          {t('arena.exitWithoutVerdict')}
        </Button>
      </Row>
      {hint !== undefined && (
        <Text
          role="status"
          variant="muted"
          data-testid="arena-verdict-hint"
          className="basis-full text-center text-xs"
        >
          {hint}
        </Text>
      )}
    </div>
  );
}

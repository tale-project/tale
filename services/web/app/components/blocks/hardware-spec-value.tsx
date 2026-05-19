import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { Minus } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Renders a single spec-table cell value. The shape of a value is one of:
 *
 *   "-"                       → an em-dash icon meaning "not available"
 *   "96GB (UMA)"              → text + a bracketed acronym
 *   "1× AMD EPYC 4545P\n…"    → multi-line; each `\n` stacks vertically
 *
 * Every bracketed `(…)` group is rendered as a smaller, raised
 * superscript-style chip in `text-fg-subtle`. If a translation exists at
 * `compare.categories.{token}Info`, the chip becomes a tooltip trigger;
 * otherwise it renders as plain text. The leading space before `(` is
 * converted to a non-breaking space so the chip never wraps away from
 * the preceding value.
 *
 * Tooltip-key convention: lowercase + non-alphanumerics stripped + `Info`.
 *   `UMA`      → `umaInfo`
 *   `DDR5 ECC` → `ddr5eccInfo`
 *   `m.2 NVMe` → `m2nvmeInfo`
 *   `Zen 5`    → `zen5Info`
 *
 * Adding a new acronym only requires adding the matching `xInfo` entry
 * under `hardwarePricing.compare.categories.*` in every locale.
 */

const SPEC_TOKEN_REGEX = /\(([^)]+)\)/g;

function tokenInfoKey(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '') + 'Info';
}

interface SpecValueProps {
  value: string;
}

export function SpecValue({ value }: SpecValueProps): ReactNode {
  const { t } = useT('hardwarePricing');
  if (!value) return null;

  if (value === '-') {
    return (
      <Minus
        className="text-fg-muted mx-auto h-5 w-5"
        strokeWidth={2}
        role="img"
        aria-label={t('compare.cellLabels.notAvailable')}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      {value.split('\n').map((line, lineIdx) => (
        <SpecLine key={lineIdx} line={line} />
      ))}
    </TooltipProvider>
  );
}

function SpecLine({ line }: { line: string }): ReactNode {
  const { t } = useT('hardwarePricing');
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(SPEC_TOKEN_REGEX)) {
    const inner = match[1];
    const infoKey = `compare.categories.${tokenInfoKey(inner)}`;
    const info = t(infoKey);
    // i18next returns the key when the translation is missing — fall back
    // to plain text so unknown bracketed tokens don't surface a tooltip
    // with the raw key as content.
    const hasTooltip = info !== infoKey;
    const start = match.index ?? 0;

    if (start > cursor) {
      // Glue the trailing space to the paren chip with a non-breaking
      // space, so "96GB (UMA)" never breaks between value and chip.
      let chunk = line.slice(cursor, start);
      if (chunk.endsWith(' ')) chunk = chunk.slice(0, -1) + '\u00A0';
      parts.push(chunk);
    }

    parts.push(
      <ParenChip
        key={`paren-${start}`}
        text={inner}
        info={hasTooltip ? info : undefined}
      />,
    );

    cursor = start + match[0].length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));

  return (
    <span className="block">
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </span>
  );
}

function ParenChip({ text, info }: { text: string; info?: string }) {
  return (
    <span className="text-fg-subtle inline-block align-super text-xs whitespace-nowrap">
      {'('}
      {info ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-help underline decoration-dotted underline-offset-2"
            >
              {text}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-xs text-center whitespace-normal"
          >
            {info}
          </TooltipContent>
        </Tooltip>
      ) : (
        text
      )}
      {')'}
    </span>
  );
}

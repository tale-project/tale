/**
 * `PiiConfigPanel` — admin-facing PII configuration UI. The single canonical
 * surface for editing a PII policy on the governance settings page.
 *
 * Sections, top to bottom:
 *
 *   1. Mode — radio group (`tokenize` / `mask` / `block`) with a
 *      one-line description of what each mode does.
 *   2. Patterns — checkbox row per built-in detector (`email`, `phone`,
 *      …). Translated labels come from the `piiTypes` namespace shipped
 *      by this package.
 *   3. Custom patterns — admin-supplied regexes (name + pattern +
 *      replacement). Compiles the regex locally with `try/catch` so the
 *      Save button can refuse a syntactically broken pattern before it
 *      ever reaches the server. Backend re-validates with `safe-regex2`.
 *
 * The pre-rewrite panel carried a live-preview pane running the detector
 * in-browser. The rewritten `lib/pii` loads its locale data through
 * `node:fs` (`data/loader.ts` — server-only by design), so the browser has
 * no data path to run the detector on; the preview returns when the library
 * grows a browser-safe data channel.
 *
 * Fully controlled: every edit fires `onChange(next)` with the complete
 * panel state so embedders can debounce, persist, or short-circuit
 * however they want.
 *
 * Translations come from the `piiConfigPanel` and `piiTypes` namespaces
 * — mounting the shared `<I18nProvider>` is the only consumer wiring.
 */

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Grid, Row, Stack } from '@tale/ui/layout';
import type { TFunction } from 'i18next';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { useT } from '@/lib/i18n/client';
import {
  BUILT_IN_PII_PATTERN_NAMES,
  type PiiCustomPattern,
} from '@/lib/shared/schemas/pii';
import { cn } from '@/lib/utils/cn';

import { piiTypeIcon } from './pii-type-icons';
import { piiTypeLabel } from './pii-type-labels';

// Re-import the type alias so we can keep the existing type name; it's
// the same `BuiltInPatternName` literal union but routed through the
// bundle-light entry point.
type BuiltInPatternName = (typeof BUILT_IN_PII_PATTERN_NAMES)[number];

export type PiiConfigPanelMode = 'tokenize' | 'mask' | 'block';

export interface PiiConfigPanelValue {
  /** What the policy does when PII is detected. */
  mode: PiiConfigPanelMode;
  /** Built-in pattern names to enable. Subset of `BUILT_IN_PII_PATTERN_NAMES`. */
  enabledPatterns: string[];
  /** Admin-supplied custom regex rules. */
  customPatterns: PiiCustomPattern[];
}

export interface PiiConfigPanelProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  /**
   * Read-only mode for admins without `write orgSettings`. Disables every
   * configuration control; the preview textarea stays interactive so the
   * admin can still inspect the active config.
   */
  disabled?: boolean;
  className?: string;
}

export function PiiConfigPanel({
  value,
  onChange,
  disabled = false,
  className,
}: PiiConfigPanelProps): ReactNode {
  const { t: tTypes } = useT('piiTypes');
  const { t: tPiiConfigPanel } = useT('piiConfigPanel');

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <ModeSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
      />
      <PatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
        tTypes={tTypes}
      />
      <CustomPatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section wrapper
// -----------------------------------------------------------------------------

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps): ReactNode {
  return (
    <Stack as="section" gap={3}>
      <Stack as="header" gap={1}>
        <h3 className="text-sm font-semibold text-[color:var(--color-fg-base)]">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            {description}
          </p>
        )}
      </Stack>
      {children}
    </Stack>
  );
}

// -----------------------------------------------------------------------------
// Mode section
// -----------------------------------------------------------------------------

interface ModeSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tPiiConfigPanel: TFunction;
}

function ModeSection({
  value,
  onChange,
  disabled,
  tPiiConfigPanel,
}: ModeSectionProps): ReactNode {
  const items: Array<{
    value: PiiConfigPanelMode;
    label: string;
    description: string;
    disabled: boolean;
  }> = [
    {
      value: 'tokenize',
      label: tPiiConfigPanel('modeTokenize'),
      description: tPiiConfigPanel('modeTokenizeDesc'),
      disabled,
    },
    {
      value: 'mask',
      label: tPiiConfigPanel('modeMask'),
      description: tPiiConfigPanel('modeMaskDesc'),
      disabled,
    },
    {
      value: 'block',
      label: tPiiConfigPanel('modeBlock'),
      description: tPiiConfigPanel('modeBlockDesc'),
      disabled,
    },
  ];
  return (
    <Section title={tPiiConfigPanel('modeLabel')}>
      <RadioGroup
        aria-label={tPiiConfigPanel('modeLabel')}
        value={value.mode}
        onValueChange={(mode) => {
          const item = items.find((i) => i.value === mode);
          if (item) onChange({ ...value, mode: item.value });
        }}
        options={items}
      />
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Built-in patterns section
// -----------------------------------------------------------------------------

interface PatternsSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tPiiConfigPanel: TFunction;
  tTypes: TFunction;
}

function PatternsSection({
  value,
  onChange,
  disabled,
  tPiiConfigPanel,
  tTypes,
}: PatternsSectionProps): ReactNode {
  const enabled = new Set(value.enabledPatterns);

  const togglePattern = (name: BuiltInPatternName, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(name);
    else next.delete(name);
    onChange({ ...value, enabledPatterns: [...next] });
  };

  return (
    <Section
      title={tPiiConfigPanel('patternsTitle')}
      description={tPiiConfigPanel('patternsDescription')}
    >
      <Grid as="ul" sm={2} gap={2}>
        {BUILT_IN_PII_PATTERN_NAMES.map((name) => {
          const Icon = piiTypeIcon(name);
          const id = `pii-pattern-${name}`;
          return (
            <li key={name}>
              <label
                htmlFor={id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] px-3 py-2 text-sm transition-colors',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:border-[color:var(--color-accent-base)]/40',
                )}
              >
                <Checkbox
                  id={id}
                  checked={enabled.has(name)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    togglePattern(name, checked === true)
                  }
                />
                <Icon
                  className="size-4 shrink-0 text-[color:var(--color-fg-muted)]"
                  aria-hidden
                />
                <span className="text-[color:var(--color-fg-base)]">
                  {piiTypeLabel(name, tTypes)}
                </span>
              </label>
            </li>
          );
        })}
      </Grid>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Custom patterns section
// -----------------------------------------------------------------------------

interface CustomPatternsSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tPiiConfigPanel: TFunction;
}

interface CustomPatternDraft {
  name: string;
  regex: string;
  replacement: string;
}

function CustomPatternsSection({
  value,
  onChange,
  disabled,
  tPiiConfigPanel,
}: CustomPatternsSectionProps): ReactNode {
  const [draft, setDraft] = useState<CustomPatternDraft | null>(null);

  const updateDraft = (patch: Partial<CustomPatternDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const regexError = useMemo(() => {
    if (!draft || !draft.regex) return null;
    try {
      // Pure validation. Result is unused — `new RegExp` throws on a
      // structural failure which is the only thing we need to catch
      // here. ReDoS detection happens server-side at save time.
      void new RegExp(draft.regex);
      return null;
    } catch (err) {
      // `console.debug` (not `warn`) so an admin typing an in-progress
      // regex doesn't spam the console on every keystroke. The
      // user-visible signal is the field error below; this line is for
      // dev-mode introspection only.
      console.debug(
        `[pii] custom pattern regex invalid: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      return tPiiConfigPanel('customPatternInvalidRegex');
    }
  }, [draft, tPiiConfigPanel]);

  const canSave =
    draft !== null &&
    draft.name.trim() !== '' &&
    draft.regex.trim() !== '' &&
    draft.replacement.trim() !== '' &&
    regexError === null;

  const saveDraft = () => {
    if (!draft || !canSave) return;
    const next = [
      ...value.customPatterns,
      {
        name: draft.name.trim(),
        regex: draft.regex,
        replacement: draft.replacement.trim(),
      },
    ];
    onChange({ ...value, customPatterns: next });
    setDraft(null);
  };

  const removePattern = (index: number) => {
    const next = value.customPatterns.filter((_, i) => i !== index);
    onChange({ ...value, customPatterns: next });
  };

  return (
    <Section
      title={tPiiConfigPanel('customPatternsTitle')}
      description={tPiiConfigPanel('customPatternsDescription')}
    >
      <Stack gap={2}>
        {value.customPatterns.map((p, index) => (
          <Row
            key={`${p.name}-${index}`}
            gap={3}
            justify="between"
            className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] px-3 py-2"
          >
            <Stack gap={0} className="min-w-0">
              <span className="truncate text-sm font-medium text-[color:var(--color-fg-base)]">
                {p.name}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[color:var(--color-fg-muted)]">
                <span className="font-mono">{p.regex}</span>
                <span aria-hidden>→</span>
                <span className="font-mono">{p.replacement}</span>
              </div>
            </Stack>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              icon={Trash2}
              disabled={disabled}
              onClick={() => removePattern(index)}
              title={`${tPiiConfigPanel('removeCustomPattern')} — ${p.name}`}
            />
          </Row>
        ))}

        {draft && (
          <Stack
            gap={3}
            className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] p-3"
          >
            <Field label={tPiiConfigPanel('customPatternNameLabel')}>
              <Input
                value={draft.name}
                disabled={disabled}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder={tPiiConfigPanel('customPatternNamePlaceholder')}
              />
            </Field>
            <Field
              label={tPiiConfigPanel('customPatternRegexLabel')}
              error={regexError ?? undefined}
            >
              <Input
                value={draft.regex}
                disabled={disabled}
                onChange={(e) => updateDraft({ regex: e.target.value })}
                placeholder={tPiiConfigPanel('customPatternRegexPlaceholder')}
                className="font-mono"
              />
            </Field>
            <Field label={tPiiConfigPanel('customPatternReplacementLabel')}>
              <Input
                value={draft.replacement}
                disabled={disabled}
                onChange={(e) => updateDraft({ replacement: e.target.value })}
                placeholder={tPiiConfigPanel(
                  'customPatternReplacementPlaceholder',
                )}
                className="font-mono"
              />
            </Field>
            <Row gap={2} align="stretch">
              <Button
                type="button"
                disabled={disabled || !canSave}
                onClick={saveDraft}
              >
                {tPiiConfigPanel('saveCustomPattern')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraft(null)}
              >
                {tPiiConfigPanel('cancelCustomPattern')}
              </Button>
            </Row>
          </Stack>
        )}

        {!draft && (
          <Button
            type="button"
            variant="secondary"
            icon={Plus}
            disabled={disabled}
            onClick={() => setDraft({ name: '', regex: '', replacement: '' })}
            className="w-fit"
          >
            {tPiiConfigPanel('addCustomPattern')}
          </Button>
        )}
      </Stack>
    </Section>
  );
}

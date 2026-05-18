'use client';

import { X } from 'lucide-react';
import { useCallback, useId, useState, type KeyboardEvent } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface TagChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Maximum number of tags. Counter turns destructive at the cap. */
  maxTags: number;
  /** Maximum characters per tag; over-length adds are rejected inline. */
  maxTagLength: number;
  /** Visible label rendered above the chips. */
  label: string;
  /** Optional placeholder for the text input. */
  placeholder?: string;
  /** Optional secondary description rendered below the counter. */
  description?: string;
  className?: string;
}

/**
 * Controlled tag input with chip rendering and inline validation.
 *
 * - Enter or comma commits the current input (after trim + dedupe).
 * - Backspace on an empty input removes the last chip.
 * - Per-tag length is enforced; over-length attempts show an inline error.
 * - Tag count is capped at `maxTags`; counter turns destructive at the cap.
 *
 * The component never throws. It is the caller's responsibility to clamp
 * `value` (e.g. when hydrating from server data). Whitespace-only tags are
 * silently dropped on commit.
 */
export function TagChipInput({
  value,
  onChange,
  maxTags,
  maxTagLength,
  label,
  placeholder,
  description,
  className,
}: TagChipInputProps) {
  const { t } = useT('prompts');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const counterId = useId();

  const atCap = value.length >= maxTags;

  const commit = useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (tag === '') return;
      if (value.length >= maxTags) {
        setError(t('tagsInput.atCap', { max: String(maxTags) }));
        return;
      }
      if (tag.length > maxTagLength) {
        setError(t('tagsInput.tooLong', { max: String(maxTagLength) }));
        return;
      }
      // Case-insensitive dedupe — `Foo` and `foo` collapse to whichever was
      // entered first. Stored casing is preserved.
      const normalized = tag.toLowerCase();
      if (value.some((existing) => existing.toLowerCase() === normalized)) {
        setDraft('');
        setError(null);
        return;
      }
      onChange([...value, tag]);
      setDraft('');
      setError(null);
    },
    [maxTagLength, maxTags, onChange, t, value],
  );

  /**
   * Multi-segment paste / drag-drop entry point. The single-`commit` loop
   * would close over the stale `value` snapshot and overwrite each prior
   * addition, so we accumulate locally and call `onChange` once with the
   * final array.
   */
  const commitMany = useCallback(
    (segments: string[]) => {
      const additions: string[] = [];
      let inlineError: string | null = null;
      for (const segment of segments) {
        const tag = segment.trim();
        if (tag === '') continue;
        if (value.length + additions.length >= maxTags) {
          inlineError = t('tagsInput.atCap', { max: String(maxTags) });
          break;
        }
        if (tag.length > maxTagLength) {
          inlineError = t('tagsInput.tooLong', { max: String(maxTagLength) });
          continue;
        }
        const normalized = tag.toLowerCase();
        const alreadyHave = [...value, ...additions].some(
          (existing) => existing.toLowerCase() === normalized,
        );
        if (alreadyHave) continue;
        additions.push(tag);
      }
      if (additions.length > 0) {
        onChange([...value, ...additions]);
      }
      setError(inlineError);
    },
    [maxTagLength, maxTags, onChange, t, value],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // IME composition: keyCode 229 (or nativeEvent.isComposing) marks a
      // keypress mid-candidate-selection in CJK input methods. Treat Enter
      // as a no-op here so users selecting a candidate via Enter don't
      // accidentally commit a partial draft as a chip.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commit(draft);
        return;
      }
      if (e.key === 'Backspace' && draft === '' && value.length > 0) {
        e.preventDefault();
        const next = value.slice(0, -1);
        onChange(next);
        setError(null);
      }
    },
    [commit, draft, onChange, value],
  );

  const removeAt = useCallback(
    (idx: number) => {
      onChange(value.filter((_, i) => i !== idx));
      setError(null);
    },
    [onChange, value],
  );

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag, idx) => (
            <span
              key={tag}
              className="text-muted-foreground border-muted-foreground bg-muted flex items-center gap-1 rounded-full border-[1.5px] py-1 pr-1 pl-2.5 text-[13px] font-medium transition-colors"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label={t('tagsInput.removeAria', { tag })}
                className="hover:bg-muted-foreground/20 focus-visible:ring-ring rounded-full p-0.5 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        label={label}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          // Comma anywhere in the value (typed, pasted, drag-dropped) splits
          // the buffer: every complete segment commits as its own chip; the
          // trailing fragment stays in the input. Only the keydown path
          // intercepts a single `,` keystroke; this covers paste + IME-safe
          // input where the keydown event never fires for the comma.
          if (raw.includes(',')) {
            const parts = raw.split(',');
            const tail = parts.pop() ?? '';
            commitMany(parts);
            setDraft(tail);
          } else {
            setDraft(raw);
            if (error) setError(null);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        errorMessage={error ?? undefined}
        // Counter ID is linked here; the Input owns its own error
        // association via `aria-errormessage` + role="alert" on the rendered
        // error message, so we don't need to repeat the error id.
        aria-describedby={counterId}
        // Keep the input enabled at cap so the documented "Backspace removes
        // last chip" affordance still works. `commit` rejects with an
        // inline error when the user tries to add past the cap.
        aria-invalid={atCap || undefined}
      />
      <Text
        id={counterId}
        variant="muted"
        className={cn('text-xs', atCap && 'text-destructive')}
      >
        {atCap
          ? t('tagsInput.atCap', { max: String(maxTags) })
          : t('tagsInput.counter', {
              count: String(value.length),
              max: String(maxTags),
            })}
        {description ? ` · ${description}` : ''}
      </Text>
    </div>
  );
}

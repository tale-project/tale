'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useRef } from 'react';

import { cn } from '@/lib/utils/cn';

interface ColorPickerInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
}

export function ColorPickerInput({
  value,
  onChange,
  label,
  id,
}: ColorPickerInputProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const handleSwatchClick = useCallback(() => {
    colorInputRef.current?.click();
  }, []);

  const normalizeHex = useCallback(
    (newValue: string) => {
      if (newValue.toUpperCase() !== value.toUpperCase()) {
        onChange(newValue.toUpperCase());
      }
    },
    [onChange, value],
  );

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      normalizeHex(e.target.value);
    },
    [normalizeHex],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 8);
      normalizeHex(`#${raw}`);
    },
    [normalizeHex],
  );

  const isValidHex = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value);
  const colorOnly = value.slice(0, 7);
  const displayValue = value.replace('#', '').toUpperCase();
  const loading = useSkeleton();

  // The swatch + hex control. Masked (to its exact footprint) while a parent
  // `<Skeletonize>` loads, so the default `#000000` swatch never flashes
  // before real branding arrives. The label stays as real text.
  const control = (
    <div
      className={cn(
        'border-border flex items-center overflow-clip rounded-md border shadow-xs',
      )}
    >
      <button
        type="button"
        onClick={handleSwatchClick}
        className={cn(
          'h-full w-7 shrink-0 cursor-pointer border-none',
          // No color set yet → a muted swatch reads as an empty slot instead of
          // an invisible white block on the white field.
          !isValidHex && 'bg-muted',
        )}
        style={isValidHex ? { backgroundColor: value } : undefined}
        aria-label={`Pick ${label.toLowerCase()}`}
      />
      <input
        ref={colorInputRef}
        type="color"
        value={isValidHex ? colorOnly : '#FFFFFF'}
        onChange={handleColorChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="flex items-center justify-center px-2 py-1.5">
        <Text as="span" variant="muted" className="leading-5">
          #
        </Text>
        <input
          id={id}
          type="text"
          value={displayValue}
          onChange={handleTextChange}
          maxLength={8}
          placeholder="6366F1"
          className="text-foreground placeholder:text-muted-foreground w-[4.5rem] border-none bg-transparent text-sm leading-5 font-normal outline-none"
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch justify-between">
      <label
        htmlFor={id}
        className="text-foreground text-sm leading-5 font-medium"
      >
        {label}
      </label>
      {loading ? <SkeletonBox>{control}</SkeletonBox> : control}
    </div>
  );
}

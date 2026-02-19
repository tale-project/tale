'use client';

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

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value.toUpperCase());
    },
    [onChange],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
      onChange(`#${raw.toUpperCase()}`);
    },
    [onChange],
  );

  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(value);
  const displayValue = value.replace('#', '');

  return (
    <div className="flex items-center justify-between">
      <label
        htmlFor={id}
        className="text-foreground text-sm leading-5 font-medium"
      >
        {label}
      </label>
      <div
        className={cn(
          'border-input flex items-center overflow-clip rounded-md border shadow-sm',
        )}
      >
        <button
          type="button"
          onClick={handleSwatchClick}
          className="h-full w-7 shrink-0 cursor-pointer border-none"
          style={{
            backgroundColor: isValidHex ? value : '#FFFFFF',
          }}
          aria-label={`Pick ${label.toLowerCase()}`}
        />
        <input
          ref={colorInputRef}
          type="color"
          value={isValidHex ? value : '#FFFFFF'}
          onChange={handleColorChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="flex items-center justify-center px-2 py-1.5">
          <span className="text-muted-foreground text-sm leading-5">#</span>
          <input
            id={id}
            type="text"
            value={displayValue}
            onChange={handleTextChange}
            maxLength={6}
            className="text-foreground w-16 border-none bg-transparent text-sm leading-5 font-normal outline-none"
            aria-label={`${label} hex value`}
          />
        </div>
      </div>
    </div>
  );
}

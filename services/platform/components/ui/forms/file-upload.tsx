'use client';

import React, { useRef, useState, useId } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { CloudUpload } from 'lucide-react';
import { Label } from './label';

interface FileUploadProps {
  accept?: string;
  onChange: (file: File) => void;
  label?: string;
  buttonText?: string;
  className?: string;
  required?: boolean;
  id?: string;
}

export function FileUpload({
  accept = '',
  onChange,
  label,
  buttonText = 'Select file',
  className = '',
  required,
  id: providedId,
}: FileUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const id = providedId ?? generatedId;

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onChange(file);
      e.target.value = '';
    }
  };

  // Create a more permissive file dialog that shows all files but highlights accepted ones
  const effectiveAccept = accept || '*';

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <Label htmlFor={id} required={required} className="mb-2 block">
          {label}
        </Label>
      )}
      <div className="flex items-start gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={handleClick}
          className="flex items-center gap-2"
        >
          <CloudUpload className="size-4" />
          {buttonText}
        </Button>
        {fileName && (
          <span className="text-sm text-muted-foreground truncate max-w-xs">
            {fileName}
          </span>
        )}
        <input
          id={id}
          type="file"
          ref={inputRef}
          onChange={handleChange}
          accept={effectiveAccept}
          className="hidden"
          required={required}
        />
      </div>
    </div>
  );
}

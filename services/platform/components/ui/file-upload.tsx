import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CloudUpload } from 'lucide-react';

interface FileUploadProps {
  accept?: string;
  onChange: (file: File) => void;
  label?: string;
  buttonText?: string;
  className?: string;
}

export function FileUpload({
  accept = '',
  onChange,
  label = 'Upload a file',
  buttonText = 'Select file',
  className = '',
}: FileUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      {label && <p className="text-sm font-medium mb-2">{label}</p>}
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
          type="file"
          ref={inputRef}
          onChange={handleChange}
          accept={effectiveAccept}
          className="hidden"
        />
      </div>
    </div>
  );
}

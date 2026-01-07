'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils/cn';
import { File } from 'lucide-react';
import type { File as MGTFileType } from '@microsoft/mgt-react';
import type { ComponentProps } from 'react';

type MGTFileProps = ComponentProps<typeof MGTFileType>;

// Dynamically load @microsoft/mgt-react (~500KB) - only loaded when DocumentIcon is rendered
const MGTFile = dynamic<MGTFileProps>(
  () => import('@microsoft/mgt-react').then((mod) => mod.File),
  {
    ssr: false,
    loading: () => <File className="size-5 text-muted-foreground" />,
  },
);

interface DocumentIconProps {
  fileName: string;
  className?: string;
}

export function DocumentIcon({
  fileName,
  className = '',
}: DocumentIconProps) {
  return (
    <div className={cn(className, 'size-7')}>
      <MGTFile fileDetails={{ name: fileName }} view="image" />
    </div>
  );
}

import { cn } from '@/lib/utils/cn';
import { File as MGTFile } from '@microsoft/mgt-react';

interface DocumentIconProps {
  fileName: string;
  className?: string;
}

export default function DocumentIcon({
  fileName,
  className = '',
}: DocumentIconProps) {
  return (
    <div className={cn(className, 'size-7')}>
      <MGTFile fileDetails={{ name: fileName }} view="image" />
    </div>
  );
}

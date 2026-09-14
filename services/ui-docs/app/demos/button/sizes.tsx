import { Button } from '@tale/ui/button';
import { Plus } from 'lucide-react';

export default function ButtonSizes() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button size="default">Default (h-9)</Button>
      <Button size="sm">Small (h-8)</Button>
      <Button size="icon" title="Add item" icon={Plus} />
      <Button size="icon-sm" title="Add item" icon={Plus} />
    </div>
  );
}

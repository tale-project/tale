import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Search } from 'lucide-react';

/**
 * One height for every control. `h-9` is the default; `h-8` is the dense
 * variant for toolbars. There is deliberately no large size — a page CTA is
 * the same height as a form control.
 */
export default function ControlHeights() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button>h-9</Button>
        <Input defaultValue="h-9" className="w-24" />
        <IconButton icon={Search} aria-label="Search" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm">h-8</Button>
        <IconButton icon={Search} size="sm" aria-label="Search" />
      </div>
      <Select
        label="Also h-9"
        value="a"
        options={[{ value: 'a', label: 'Every control agrees' }]}
      />
    </div>
  );
}

import { Button } from '@tale/ui/button';
import { Download, Trash2 } from 'lucide-react';

export default function ButtonWithIcon() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button icon={Download}>Export</Button>
      <Button variant="secondary" icon={Trash2}>
        Delete
      </Button>
      <Button variant="secondary" icon={Download} collapseLabel>
        Collapses on mobile
      </Button>
    </div>
  );
}

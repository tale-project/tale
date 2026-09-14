import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Input } from '@tale/ui/input';

/**
 * Tab into this example. Every interactive surface answers with the same
 * ring — `ring-ring` over `ring-offset-background` — and the focus style only
 * appears for keyboard focus, never on a mouse click.
 */
export default function FocusRing() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Button variant="secondary">Tab to me</Button>
      <Input label="Then to me" defaultValue="" />
      <Card asChild padding="md" interactive>
        <button type="button" className="text-left">
          <span className="text-sm font-medium">And to this card</span>
        </button>
      </Card>
    </div>
  );
}

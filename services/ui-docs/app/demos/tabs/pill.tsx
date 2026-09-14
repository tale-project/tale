import { Badge } from '@tale/ui/badge';
import { Tabs } from '@tale/ui/tabs';

export default function TabsPill() {
  return (
    <div className="w-full max-w-lg">
      <Tabs
        variant="pill"
        equalWidth
        defaultValue="open"
        listAriaLabel="Approval queue"
        actions={<Badge variant="blue">3 waiting</Badge>}
        items={[
          {
            value: 'open',
            label: 'Open',
            content: (
              <p className="text-muted-foreground py-4 text-sm">
                Requests still waiting for a decision.
              </p>
            ),
          },
          {
            value: 'approved',
            label: 'Approved',
            content: (
              <p className="text-muted-foreground py-4 text-sm">
                Everything that was let through.
              </p>
            ),
          },
        ]}
      />
    </div>
  );
}

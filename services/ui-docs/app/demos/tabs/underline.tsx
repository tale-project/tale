import { Tabs } from '@tale/ui/tabs';

export default function TabsUnderline() {
  return (
    <div className="w-full max-w-lg">
      <Tabs
        variant="underline"
        defaultValue="overview"
        listAriaLabel="Agent detail"
        items={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <p className="text-muted-foreground py-4 text-sm">
                What this agent does and which model it runs on.
              </p>
            ),
          },
          {
            value: 'skills',
            label: 'Skills',
            content: (
              <p className="text-muted-foreground py-4 text-sm">
                The skills the agent may call during a turn.
              </p>
            ),
          },
          {
            value: 'runs',
            label: 'Runs',
            content: (
              <p className="text-muted-foreground py-4 text-sm">
                Every execution, with its cost and its transcript.
              </p>
            ),
          },
        ]}
      />
    </div>
  );
}

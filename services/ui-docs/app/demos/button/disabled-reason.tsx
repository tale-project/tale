import { Button } from '@tale/ui/button';

export default function ButtonDisabledReason() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button disabled>No explanation</Button>
      <Button
        disabled
        disabledReason="Connect a model provider before you can publish."
      >
        Publish
      </Button>
    </div>
  );
}

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';

/**
 * `Heading` carries the size axis; `level` is a separate, semantic axis. The
 * headings below are rendered at `level={3}` on purpose so the example never
 * disturbs the page's own outline.
 */
export default function TypeScale() {
  return (
    <div className="flex w-full flex-col gap-4">
      {(['2xl', 'xl', 'lg', 'base', 'sm', 'xs'] as const).map((size) => (
        <div key={size} className="flex items-baseline gap-4">
          <code className="text-muted-foreground w-14 shrink-0 text-[11px]">
            {size}
          </code>
          <Heading level={3} size={size}>
            The quick brown fox
          </Heading>
        </div>
      ))}
      <div className="border-border mt-2 flex flex-col gap-2 border-t pt-4">
        <Text variant="body">body — the default paragraph</Text>
        <Text variant="muted">muted — a secondary explanation</Text>
        <Text variant="caption">caption — metadata and counters</Text>
        <Text variant="label">label — a field label</Text>
        <Text variant="code">code — an inline monospace run</Text>
      </div>
    </div>
  );
}

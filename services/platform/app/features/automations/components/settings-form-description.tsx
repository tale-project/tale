'use client';

import { ReadMore } from '@tale/ui/read-more';
import { Text } from '@tale/ui/text';

/**
 * A declared settings form's operator instructions, clamped to three lines
 * behind Read more. Pack authors write whole handbooks into `description`,
 * and the first-time setup gate stacks several forms — so unclamped prose
 * buries the very fields it explains.
 */
export function SettingsFormDescription({ text }: { text: string }) {
  return (
    <ReadMore lines={3} toggleClassName="text-xs">
      <Text as="p" variant="muted">
        {text}
      </Text>
    </ReadMore>
  );
}

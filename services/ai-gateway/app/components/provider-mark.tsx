import { cn } from '@tale/ui/cn';
import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';

import type { ProviderId } from '@/app/lib/api';

const MARKS = {
  anthropic: ClaudeIcon,
  openai: OpenAIIcon,
} as const satisfies Record<ProviderId, unknown>;

/**
 * The vendor mark for a provider — sized for a `TableIconCell` plain slot
 * unless the caller asks for another size (a picker option sits at `size-4`,
 * the height of the text beside it).
 *
 * Decorative wherever it appears: every place that draws it also names the
 * provider in words, so the mark stays hidden from assistive technology.
 */
export function ProviderMark({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) {
  const Mark = MARKS[provider];
  return <Mark className={cn('size-5 shrink-0', className)} />;
}

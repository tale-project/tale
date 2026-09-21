import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';

import type { ProviderId } from '@/app/lib/api';

const MARKS = {
  anthropic: ClaudeIcon,
  openai: OpenAIIcon,
} as const satisfies Record<ProviderId, unknown>;

/** The vendor mark for a provider, sized for a `TableIconCell` plain slot. */
export function ProviderMark({ provider }: { provider: ProviderId }) {
  const Mark = MARKS[provider];
  return <Mark className="size-5" />;
}

import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';
import { Bot, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * The mark an app is shown with, by the host it proved it owns. A known
 * vendor's icon appears only for a host Tale verified — an app that
 * registered itself, or a host nobody checked, gets the neutral glyph,
 * because an icon is a claim of who the app is and a name or a logo the app
 * chose for itself is the easiest thing to fake. The app's own image is
 * never loaded.
 */

type AgentClientMark = ComponentType<{ className?: string }> | LucideIcon;

/** Hosts whose icon is shown, matched exactly: a subdomain is a different
 * owner. */
const VENDOR_MARKS: ReadonlyMap<string, AgentClientMark> = new Map([
  ['claude.ai', ClaudeIcon],
  ['claude.com', ClaudeIcon],
  ['chatgpt.com', OpenAIIcon],
  ['openai.com', OpenAIIcon],
]);

/** The mark for an app whose verified host is `host`, or null for an app
 * nobody verified. */
export function agentClientMark(host: string | null): AgentClientMark {
  return (host === null ? undefined : VENDOR_MARKS.get(host)) ?? Bot;
}

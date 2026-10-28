/**
 * Whether a turn can be sent to a catalog entry — the boundary every chat
 * model listing and every explicit model reference share, so a picker never
 * offers a model a turn then refuses.
 *
 * A conversational model carries the `chat` tag. A media generator that also
 * writes text carries it as well (Gemini 2.5 Flash Image describes what it
 * drew), but a turn always offers the model its tools — a chat message at
 * least knowledge search — and a provider sends a request with tools to no
 * endpoint of a generator that takes none: OpenRouter answers 404 "No
 * endpoints found that support tool use" before the model sees a word. Such
 * a model draws through the image tool, as the organization's image model,
 * never as the model a turn runs on. A generator that does take tools still
 * answers a turn.
 *
 * Pure — shared by the backend's walks and the settings pickers.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';

export function answersChatTurns(
  entry: Pick<ModelCatalogEntry, 'tags' | 'outputsMedia' | 'supportsTools'>,
): boolean {
  if (!entry.tags.includes('chat')) return false;
  return entry.outputsMedia !== true || entry.supportsTools;
}

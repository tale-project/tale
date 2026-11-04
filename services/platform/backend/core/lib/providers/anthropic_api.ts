/**
 * The one predicate for "a harness calling this model reaches Anthropic's
 * Messages API": the connector speaks Anthropic's API format, so the gateway
 * translates a chat-wire harness onto it; or the model is a Claude model,
 * which an OpenAI-compatible upstream behind the connector (a gateway, a
 * router) translates onto that API in turn. A harness whose tools do not
 * survive that translation (`anthropicModels: false` in its yml) runs no such
 * model: the composer listing, harness status and the serving walks flag it
 * through this predicate, so the pickers offer what a turn will run.
 */

import { isClaudeModelRef } from '../../../../lib/harnesses/exec-builder';

export function servedByAnthropicApi(
  connector: { readonly apiFormat: string },
  modelId: string,
): boolean {
  return connector.apiFormat === 'anthropic' || isClaudeModelRef(modelId);
}

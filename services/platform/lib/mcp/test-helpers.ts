import {
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
  resourceTarget,
} from './resources';

/**
 * What the guards over the agent-facing texts (instructions, prompts, the
 * skill) share: the `tale://` addresses a text names, and whether the server
 * reads each — a fixed resource, an address template as listed (with its
 * `{placeholders}`), or a concrete address a template stands for.
 */

/** Every `tale://` address a text names, without trailing punctuation. */
export function mentionedAddresses(text: string): string[] {
  return [
    ...new Set(
      (text.match(/tale:\/\/[^\s)"'`,;]+/g) ?? []).map((address) =>
        address.replace(/[.:]+$/, ''),
      ),
    ),
  ];
}

export function isServedAddress(address: string): boolean {
  if (MCP_STATIC_RESOURCES.some((resource) => resource.uri === address)) {
    return true;
  }
  if (
    MCP_RESOURCE_TEMPLATES.some((template) => template.uriTemplate === address)
  ) {
    return true;
  }
  // A template's placeholders filled in, or a concrete address.
  return !(
    'problem' in
    resourceTarget(
      address.replace(/\{[A-Za-z]+\}/g, (slot) =>
        slot === '{version}' ? '1' : 'x',
      ),
    )
  );
}

/** The snake_case words a text uses — the shape every tool name has. */
export function toolLikeWords(text: string): string[] {
  return [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].sort();
}

import { extname } from 'node:path';

import { parseDocument } from 'yaml';

import { preconditionError } from '../../utils/fail';

/**
 * Parse a declaration the deployment commands read from a file: the deployment
 * spec and the configuration declaration it points at. It is YAML when its
 * extension says so and JSON otherwise, so one declaration means the same
 * thing to the schemas that follow however its author spelled it.
 *
 * YAML is read strictly. A key written twice, an alias, a second document and
 * anything the parser reports are refused in fixed words, because a parser's
 * own message quotes the input and a spec carries environment references.
 * JSON that does not parse is refused the same way.
 */
export function parseDeclarationText(text: string, path: string): unknown {
  if (!['.yaml', '.yml'].includes(extname(path).toLowerCase())) {
    try {
      return JSON.parse(text);
    } catch {
      throw preconditionError('Deployment declaration JSON is invalid.');
    }
  }
  const invalid = () =>
    preconditionError('Deployment declaration YAML is invalid.');
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw invalid();
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    throw invalid();
  }
}

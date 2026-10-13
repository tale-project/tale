import {
  extensionOf,
  safeArtifactName,
  TEXT_ARTIFACT_TYPES,
} from '../../../lib/agent/artifacts.ts';
import { CREATE_FILE_MAX_BYTES } from '../../../lib/agent/work-tools.ts';
import { failure, isArgsRecord, type WorkToolScope } from './scope.ts';

/**
 * `create_file` — store a file whose content the model typed out, and
 * attach it. No sandbox: the bytes are the content, UTF-8 encoded, stored
 * as given. Only the text formats of `TEXT_ARTIFACT_TYPES` are accepted,
 * because a typed-out "PDF" would be a corrupt file under a trusted name.
 */
export async function runCreateFile(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  if (!isArgsRecord(input)) {
    return failure(
      'invalid_args',
      'create_file takes {"name": "<file name with extension>", "content": "<the whole file>"}.',
    );
  }
  const rawName = typeof input.name === 'string' ? input.name : '';
  const name = safeArtifactName(rawName);
  if (name === null) {
    return failure(
      'invalid_args',
      'Give "name" as a plain file name with its extension, e.g. "notes.md".',
    );
  }
  const extension = extensionOf(name);
  const mediaType = TEXT_ARTIFACT_TYPES[extension];
  if (mediaType === undefined) {
    return failure(
      'invalid_args',
      extension === ''
        ? `"${name}" has no extension; add one such as .md, .csv, .json or .html.`
        : `create_file writes text formats only, and .${extension} is not one of them (${Object.keys(TEXT_ARTIFACT_TYPES).join(', ')}). Make binary files such as DOCX, XLSX, PPTX, PDF or PNG with run_code.`,
    );
  }
  if (typeof input.content !== 'string') {
    return failure('invalid_args', '"content" must be the text of the file.');
  }
  const bytes = new TextEncoder().encode(input.content);
  if (bytes.byteLength === 0) {
    return failure('invalid_args', '"content" is empty; write the file out.');
  }
  if (bytes.byteLength > CREATE_FILE_MAX_BYTES) {
    return failure(
      'invalid_args',
      `"content" is ${Math.ceil(bytes.byteLength / 1024)} KB; create_file stores at most ${CREATE_FILE_MAX_BYTES / 1024} KB. Split it, or write it with run_code.`,
    );
  }
  const artifact = await scope.artifacts.store({ name, mediaType, bytes });
  return {
    status: 'ok',
    message: `Attached ${artifact.name} to the conversation.`,
    artifacts: [artifact],
  };
}

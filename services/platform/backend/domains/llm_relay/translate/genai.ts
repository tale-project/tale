import {
  isJSONValue,
  type JSONSchema7,
  type JSONValue,
  type LanguageModelV4Content,
  type LanguageModelV4File,
  type LanguageModelV4FilePart,
  type LanguageModelV4FinishReason,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4Message,
  type LanguageModelV4StreamPart,
  type LanguageModelV4ToolChoice,
  type LanguageModelV4ToolResultOutput,
  type LanguageModelV4ToolResultPart,
  type LanguageModelV4Usage,
  type SharedV4ProviderOptions,
} from '@ai-sdk/provider';

import { isRecord } from '../../../../lib/utils/type-utils.ts';
import { errorBody, type RelayErrorKind } from '../wires.ts';
import {
  type Carried,
  type CarriedOptions,
  carriedOptions,
  isSealed,
  mergeCarried,
  providerOptionsOf,
  seal,
  unseal,
} from './carry.ts';
import {
  type EncodeContext,
  type InboundAdapter,
  type ParsedRequest,
  TranslationError,
} from './contract.ts';

/**
 * Google GenAI as a client's wire (tale-project/tale#4942): a Gemini API
 * `generateContent` / `streamGenerateContent?alt=sse` request read into the
 * AI SDK's call, and the model's answer written back as GenAI's
 * `GenerateContentResponse`. Gemini CLI speaks it. No connector does, so a
 * GenAI call is always translated: to Chat Completions (Gemini models
 * through Google's OpenAI-compatible endpoint, or any other model) or to
 * Anthropic Messages.
 *
 * The request's path names the model and whether to stream, and the relay
 * reads it there: the body carries neither.
 *
 * What a provider asks to have back with its answer travels in GenAI's own
 * carrier, a part's `thoughtSignature` (`carry.ts`): a call's Google
 * signature as Google wrote it, anything else sealed by the relay.
 */

type CallOptions = ParsedRequest['options'];
type AssistantPart = Extract<
  LanguageModelV4Message,
  { role: 'assistant' }
>['content'][number];
type UserPart = Extract<
  LanguageModelV4Message,
  { role: 'user' }
>['content'][number];
type OutputItem = Extract<
  LanguageModelV4ToolResultOutput,
  { type: 'content' }
>['value'][number];

/** What a part of the model's turn says, as GenAI writes it. */
type GenAiPayload =
  | { text: string; thought?: true }
  | {
      functionCall: { name: string; args: Record<string, unknown>; id: string };
    }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

/** A part of the model's turn: what it says, and what it carries back to
 * the provider. */
type GenAiPart = GenAiPayload & { thoughtSignature?: string };

/** Says, once per request and feature, what the relay leaves out of a call
 * because the model's provider has no counterpart for it. */
type Drop = (feature: string, why: string) => void;

function dropper(): Drop {
  const said = new Set<string>();
  return (feature, why) => {
    if (said.has(feature)) return;
    said.add(feature);
    console.warn(
      `[llm-relay] dropped from a GenAI request: ${feature} (${why})`,
    );
  };
}

/** The request fields the relay reads, or ignores knowing nothing is lost:
 * safety settings and labels are Google's own, and the model is in the
 * path. */
const REQUEST_FIELDS = new Set([
  'contents',
  'systemInstruction',
  'tools',
  'toolConfig',
  'generationConfig',
  'safetySettings',
  'labels',
  'model',
]);

/** The `generationConfig` fields the relay reads. */
const GENERATION_FIELDS = new Set([
  'maxOutputTokens',
  'temperature',
  'topP',
  'topK',
  'seed',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'candidateCount',
  'responseMimeType',
  'responseSchema',
  'responseJsonSchema',
  'thinkingConfig',
]);

/** What a part may carry besides its payload. The carrier
 * (`thoughtSignature`) is read with the payload it travels on; alone, it
 * comes back with nothing to restore it to. */
const PART_METADATA = new Set([
  'thought',
  'thoughtSignature',
  'partMetadata',
  'videoMetadata',
  'mediaResolution',
]);

/** Gemini CLI's stand-in for a signature it does not have (Google accepts
 * it in place of one): no provider's own, so never passed on. */
const STAND_IN_SIGNATURE = 'skip_thought_signature_validator';

/** A part's carrier, unless it is empty or Gemini CLI's stand-in. */
function carrierAt(part: Record<string, unknown>): string | undefined {
  const value = part.thoughtSignature;
  return typeof value === 'string' &&
    value !== '' &&
    value !== STAND_IN_SIGNATURE
    ? value
    : undefined;
}

const EMPTY_OBJECT_SCHEMA: JSONSchema7 = { type: 'object', properties: {} };

/** A number field, or undefined when it is absent; another type is refused,
 * as the Gemini API refuses it. */
function numberAt(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TranslationError(`${path}.${key} must be a number`);
  }
  return value;
}

/** A client's id for a call, when it sent one. */
function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A JSON Schema, as far as the relay checks one: an object. What its
 * keywords say is the upstream's to judge. */
function isJsonSchema(value: unknown): value is JSONSchema7 {
  return isRecord(value);
}

/**
 * A Gemini `Schema` — an OpenAPI 3.0 subset, with upper-case types and
 * `nullable` — as the JSON Schema the SDK's tools carry. `propertyOrdering`
 * only orders Gemini's own output, so it goes.
 */
function jsonSchemaOf(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case 'type':
        if (typeof value === 'string') {
          if (value.toUpperCase() !== 'TYPE_UNSPECIFIED') {
            converted.type = value.toLowerCase();
          }
        } else {
          converted.type = Array.isArray(value)
            ? value.map((name) =>
                typeof name === 'string' ? name.toLowerCase() : name,
              )
            : value;
        }
        break;
      case 'properties':
        converted.properties = isRecord(value)
          ? Object.fromEntries(
              Object.entries(value).map(([name, property]) => [
                name,
                isRecord(property) ? jsonSchemaOf(property) : property,
              ]),
            )
          : value;
        break;
      case 'items':
        converted.items = isRecord(value) ? jsonSchemaOf(value) : value;
        break;
      case 'anyOf':
        converted.anyOf = Array.isArray(value)
          ? value.map((option) =>
              isRecord(option) ? jsonSchemaOf(option) : option,
            )
          : value;
        break;
      case 'example':
        converted.examples = [value];
        break;
      case 'nullable':
      case 'propertyOrdering':
        break;
      default:
        converted[key] = value;
    }
  }
  if (schema.nullable === true) {
    if (typeof converted.type === 'string') {
      converted.type = [converted.type, 'null'];
    } else if (Array.isArray(converted.anyOf)) {
      converted.anyOf = [...converted.anyOf, { type: 'null' }];
    }
    // An `enum` holds only its own values: null must be one of them.
    if (Array.isArray(converted.enum) && !converted.enum.includes(null)) {
      converted.enum = [...converted.enum, null];
    }
  }
  return converted;
}

/** A tool's input as every upstream takes it: an object schema with its
 * properties spelled out, since some refuse an empty one. */
function inputSchemaOf(schema: Record<string, unknown>): JSONSchema7 {
  if (Object.keys(schema).length === 0) return EMPTY_OBJECT_SCHEMA;
  const shaped =
    schema.type === 'object' && schema.properties === undefined
      ? { ...schema, properties: {} }
      : schema;
  return isJsonSchema(shaped) ? shaped : EMPTY_OBJECT_SCHEMA;
}

/** The system message: `systemInstruction`'s text, from a Content or a
 * bare string. */
function systemOf(value: unknown, drop: Drop): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (!isRecord(value) || !Array.isArray(value.parts)) {
    throw new TranslationError(
      'systemInstruction must be a Content with parts, or a string',
    );
  }
  const texts: string[] = [];
  for (const part of value.parts) {
    if (isRecord(part) && typeof part.text === 'string') {
      if (part.text !== '') texts.push(part.text);
    } else {
      drop(
        'systemInstruction media',
        "the model's provider takes a system message as text only",
      );
    }
  }
  return texts.join('\n');
}

/** An `inlineData` part: a file sent as base64. */
function inlineFileOf(value: unknown, where: string): LanguageModelV4FilePart {
  if (
    !isRecord(value) ||
    typeof value.mimeType !== 'string' ||
    value.mimeType === '' ||
    typeof value.data !== 'string'
  ) {
    throw new TranslationError(`${where} needs a mimeType and base64 data`);
  }
  return {
    type: 'file',
    mediaType: value.mimeType,
    data: { type: 'data', data: value.data },
  };
}

/** A `fileData` part: a file the model's provider fetches by its URI. */
function linkedFileOf(value: unknown, where: string): LanguageModelV4FilePart {
  if (!isRecord(value) || typeof value.fileUri !== 'string') {
    throw new TranslationError(`${where} needs a fileUri`);
  }
  if (typeof value.mimeType !== 'string' || value.mimeType === '') {
    // GenAI may infer the type of a file it stores; another provider is
    // told what kind of file it is fetching.
    throw new TranslationError(
      `${where} needs a mimeType: the model's provider must be told what kind of file it is`,
    );
  }
  if (!URL.canParse(value.fileUri)) {
    throw new TranslationError(`${where}.fileUri is not a URL`);
  }
  const url = new URL(value.fileUri);
  return {
    type: 'file',
    mediaType: value.mimeType,
    data: {
      type: 'url',
      url,
      ...(url.href === value.fileUri ? {} : { originalUrl: value.fileUri }),
    },
  };
}

/** The media a function's response carries beside its JSON (GenAI's
 * multimodal function response). */
function responseMediaOf(
  value: unknown,
  where: string,
  drop: Drop,
): OutputItem[] {
  if (!Array.isArray(value)) return [];
  const media: OutputItem[] = [];
  for (const [index, part] of value.entries()) {
    const at = `${where}[${index}]`;
    if (isRecord(part) && part.inlineData !== undefined) {
      media.push(inlineFileOf(part.inlineData, `${at}.inlineData`));
    } else if (isRecord(part) && part.fileData !== undefined) {
      media.push(linkedFileOf(part.fileData, `${at}.fileData`));
    } else {
      drop(
        'functionResponse.parts entries other than files',
        'the relay knows no such part',
      );
    }
  }
  return media;
}

/**
 * A function's result as the SDK's tool output. GenAI's convention is that
 * `output` holds what the function returned and `error` what went wrong,
 * and anything else is the result as a whole: a lone `output` or `error` is
 * unwrapped, so the model reads a file's text as text and a failure as one.
 */
function toolOutputOf(
  response: unknown,
  media: OutputItem[],
): LanguageModelV4ToolResultOutput {
  let value: unknown = response ?? {};
  let failed = false;
  if (isRecord(response)) {
    const keys = Object.keys(response);
    if (keys.length === 1 && keys[0] === 'output') {
      value = response.output;
    } else if (keys.length === 1 && keys[0] === 'error') {
      value = response.error;
      failed = true;
    }
  }
  const json: JSONValue = isJSONValue(value) ? value : null;
  if (media.length > 0) {
    const text = typeof json === 'string' ? json : JSON.stringify(json);
    return {
      type: 'content',
      value: [
        ...(text === '' ? [] : [{ type: 'text' as const, text }]),
        ...media,
      ],
    };
  }
  if (typeof json === 'string') {
    return failed
      ? { type: 'error-text', value: json }
      : { type: 'text', value: json };
  }
  return failed
    ? { type: 'error-json', value: json }
    : { type: 'json', value: json };
}

/** One GenAI part, read: what it says, and the carrier it came back with,
 * before its turn's role places it. */
type ReadPart =
  | {
      kind: 'text';
      text: string;
      thought: boolean;
      carrier: string | undefined;
    }
  | {
      kind: 'file';
      file: LanguageModelV4FilePart;
      carrier: string | undefined;
    }
  | {
      kind: 'call';
      name: string;
      args: Record<string, unknown>;
      id: string | undefined;
      carrier: string | undefined;
    }
  | {
      kind: 'response';
      name: string;
      id: string | undefined;
      output: LanguageModelV4ToolResultOutput;
    };

/** A part of a turn, or null for one that says nothing another provider can
 * hear (an empty text, a thought signature alone, code Google ran). */
function readPart(part: unknown, where: string, drop: Drop): ReadPart | null {
  if (!isRecord(part)) throw new TranslationError(`${where} must be an object`);
  const carrier = carrierAt(part);
  if (part.functionCall !== undefined) {
    const call = part.functionCall;
    if (!isRecord(call) || typeof call.name !== 'string' || call.name === '') {
      throw new TranslationError(
        `${where}.functionCall needs the name of the function`,
      );
    }
    const args = call.args ?? {};
    if (!isRecord(args)) {
      throw new TranslationError(
        `${where}.functionCall.args must be an object`,
      );
    }
    return { kind: 'call', name: call.name, args, id: idOf(call.id), carrier };
  }
  if (part.functionResponse !== undefined) {
    const response = part.functionResponse;
    if (
      !isRecord(response) ||
      typeof response.name !== 'string' ||
      response.name === ''
    ) {
      throw new TranslationError(
        `${where}.functionResponse needs the name of the function it answers`,
      );
    }
    const media = responseMediaOf(
      response.parts,
      `${where}.functionResponse.parts`,
      drop,
    );
    return {
      kind: 'response',
      name: response.name,
      id: idOf(response.id),
      output: toolOutputOf(response.response, media),
    };
  }
  if (part.text !== undefined) {
    if (typeof part.text !== 'string') {
      throw new TranslationError(`${where}.text must be a string`);
    }
    if (part.text === '') return null;
    return {
      kind: 'text',
      text: part.text,
      thought: part.thought === true,
      carrier,
    };
  }
  if (part.inlineData !== undefined) {
    return {
      kind: 'file',
      file: inlineFileOf(part.inlineData, `${where}.inlineData`),
      carrier,
    };
  }
  if (part.fileData !== undefined) {
    return {
      kind: 'file',
      file: linkedFileOf(part.fileData, `${where}.fileData`),
      carrier,
    };
  }
  if (
    part.executableCode !== undefined ||
    part.codeExecutionResult !== undefined
  ) {
    drop(
      'code execution parts',
      "code the model ran on Google's servers has no counterpart on the model's provider",
    );
    return null;
  }
  const payload = Object.keys(part).filter((key) => !PART_METADATA.has(key));
  if (payload.length > 0) {
    drop(`${payload.join(', ')} parts`, 'the relay knows no such part');
  }
  return null;
}

/** A model's call, as the conversation so far knows it. */
interface Call {
  /** The id the client gave the call, which its response may repeat. */
  clientId: string | undefined;
  /** The id the upstream sees. */
  id: string;
  name: string;
  answered: boolean;
}

/**
 * The thinking a sealed carrier brings back, put before the part that
 * carried it: once per turn, however many of the turn's parts carried it
 * (a thought and the part after it carry the same seal). Gives what the
 * seal carried, for a call's own fields; nothing for a value that is not
 * the relay's.
 */
function restoreThinking(
  carrier: string | undefined,
  answer: AssistantPart[],
  restored: Set<string>,
): Carried | undefined {
  if (!isSealed(carrier)) return undefined;
  const carried = unseal(carrier);
  if (carried?.options !== undefined && !restored.has(carrier)) {
    restored.add(carrier);
    answer.push({
      type: 'reasoning',
      text: carried.text ?? '',
      providerOptions: carried.options,
    });
  }
  return carried;
}

/**
 * A thought, as the reasoning it was. One that carries its thinking block's
 * seal is that block, with the text the provider signed: the thoughts
 * streamed before it, which a client may keep apart, were the start of that
 * text, and go.
 */
function restoreThought(
  text: string,
  carrier: string | undefined,
  answer: AssistantPart[],
  restored: Set<string>,
): void {
  const carried = isSealed(carrier) ? unseal(carrier) : undefined;
  if (carrier === undefined || carried?.options === undefined) {
    answer.push({ type: 'reasoning', text });
    return;
  }
  if (restored.has(carrier)) return;
  restored.add(carrier);
  if (carried.text !== undefined) {
    for (;;) {
      const last = answer[answer.length - 1];
      if (last?.type !== 'reasoning' || last.providerOptions !== undefined) {
        break;
      }
      answer.pop();
    }
  }
  answer.push({
    type: 'reasoning',
    text: carried.text ?? text,
    providerOptions: carried.options,
  });
}

/**
 * What a call carries back to its provider: unsealed, Google's own
 * signature; sealed, the fields the seal holds for the call, under the id
 * the relay wrote — which Gemini CLI prefixes with the function's name.
 */
function callOptionsOf(
  carrier: string | undefined,
  carried: Carried | undefined,
  clientId: string | undefined,
  name: string,
): SharedV4ProviderOptions | undefined {
  if (carrier === undefined) return undefined;
  if (!isSealed(carrier)) return { google: { thoughtSignature: carrier } };
  if (clientId === undefined) return undefined;
  const prefix = `${name}__`;
  return (
    providerOptionsOf(carried, clientId) ??
    (clientId.startsWith(prefix)
      ? providerOptionsOf(carried, clientId.slice(prefix.length))
      : undefined)
  );
}

/**
 * The SDK messages one GenAI turn becomes: a model turn the assistant's
 * message; a user turn the tool results it carries, in a tool message as
 * the SDK requires, then the rest.
 *
 * Every call gets an id of the relay's own (`call_<turn>_<part>`): GenAI
 * may send none, and Gemini CLI's are `<function>__<id>`, longer than some
 * upstreams accept and spelled with what others refuse. The client's ids
 * only pair a response with its call: by id, or else the earliest
 * unanswered call of the same function, as GenAI pairs them.
 *
 * A model turn's carriers give back what the provider asked for with it:
 * the thinking a seal holds, and a call's own fields.
 */
function turnMessages(
  turn: unknown,
  turnIndex: number,
  calls: Call[],
  drop: Drop,
): LanguageModelV4Message[] {
  const where = `contents[${turnIndex}]`;
  if (!isRecord(turn)) {
    throw new TranslationError(
      `${where} must be an object with a role and parts`,
    );
  }
  const role =
    turn.role === undefined || turn.role === null || turn.role === ''
      ? 'user'
      : turn.role;
  if (role !== 'user' && role !== 'model') {
    throw new TranslationError(`${where}.role must be "user" or "model"`);
  }
  if (!Array.isArray(turn.parts)) {
    throw new TranslationError(`${where}.parts must be an array`);
  }
  const answer: AssistantPart[] = [];
  const said: UserPart[] = [];
  const results: LanguageModelV4ToolResultPart[] = [];
  const restored = new Set<string>();
  for (const [partIndex, raw] of turn.parts.entries()) {
    const at = `${where}.parts[${partIndex}]`;
    const part = readPart(raw, at, drop);
    if (part === null) continue;
    switch (part.kind) {
      case 'text':
        if (role === 'user') {
          said.push({ type: 'text', text: part.text });
        } else if (part.thought) {
          restoreThought(part.text, part.carrier, answer, restored);
        } else {
          restoreThinking(part.carrier, answer, restored);
          answer.push({ type: 'text', text: part.text });
        }
        break;
      case 'file':
        if (role === 'user') {
          said.push(part.file);
        } else {
          restoreThinking(part.carrier, answer, restored);
          answer.push(part.file);
        }
        break;
      case 'call': {
        if (role !== 'model') {
          throw new TranslationError(
            `${at}.functionCall belongs in a model turn`,
          );
        }
        const id = `call_${turnIndex}_${partIndex}`;
        calls.push({ clientId: part.id, id, name: part.name, answered: false });
        const carried = restoreThinking(part.carrier, answer, restored);
        const providerOptions = callOptionsOf(
          part.carrier,
          carried,
          part.id,
          part.name,
        );
        answer.push({
          type: 'tool-call',
          toolCallId: id,
          toolName: part.name,
          input: part.args,
          ...(providerOptions === undefined ? {} : { providerOptions }),
        });
        break;
      }
      case 'response': {
        if (role !== 'user') {
          throw new TranslationError(
            `${at}.functionResponse belongs in a user turn`,
          );
        }
        const call =
          (part.id === undefined
            ? undefined
            : calls.find(
                (each) => !each.answered && each.clientId === part.id,
              )) ??
          calls.find((each) => !each.answered && each.name === part.name);
        if (call === undefined) {
          throw new TranslationError(
            `${at}.functionResponse answers no earlier functionCall of "${part.name}"`,
          );
        }
        call.answered = true;
        results.push({
          type: 'tool-result',
          toolCallId: call.id,
          toolName: call.name,
          output: part.output,
        });
        break;
      }
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  const messages: LanguageModelV4Message[] = [];
  if (answer.length > 0) messages.push({ role: 'assistant', content: answer });
  if (results.length > 0) messages.push({ role: 'tool', content: results });
  if (said.length > 0) messages.push({ role: 'user', content: said });
  return messages;
}

/** One function declaration as the SDK's function tool. */
function functionToolOf(
  value: unknown,
  where: string,
): LanguageModelV4FunctionTool {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '') {
    throw new TranslationError(`${where} needs a name`);
  }
  const schema = isRecord(value.parametersJsonSchema)
    ? value.parametersJsonSchema
    : isRecord(value.parameters)
      ? jsonSchemaOf(value.parameters)
      : {};
  return {
    type: 'function',
    name: value.name,
    ...(typeof value.description === 'string' && value.description !== ''
      ? { description: value.description }
      : {}),
    inputSchema: inputSchemaOf(schema),
  };
}

/** The function tools a request declares. Google's built-in tools (search,
 * code execution, URL context, computer use) run only on Google's API, so
 * they go, each named once. */
function toolsOf(value: unknown, drop: Drop): LanguageModelV4FunctionTool[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new TranslationError('tools must be an array');
  const tools: LanguageModelV4FunctionTool[] = [];
  for (const [toolIndex, tool] of value.entries()) {
    if (!isRecord(tool)) {
      throw new TranslationError(`tools[${toolIndex}] must be an object`);
    }
    for (const [key, entry] of Object.entries(tool)) {
      if (key !== 'functionDeclarations') {
        drop(
          `${key} tool`,
          "Google's built-in tools run only on Google's own API",
        );
        continue;
      }
      if (!Array.isArray(entry)) {
        throw new TranslationError(
          `tools[${toolIndex}].functionDeclarations must be an array`,
        );
      }
      for (const [index, declaration] of entry.entries()) {
        tools.push(
          functionToolOf(
            declaration,
            `tools[${toolIndex}].functionDeclarations[${index}]`,
          ),
        );
      }
    }
  }
  return tools;
}

/**
 * How the model must use its tools: `toolConfig.functionCallingConfig`. A
 * mode limited to some functions keeps only those tools, the one way the
 * SDK can say it; ANY with one function names that one.
 */
function toolUseOf(
  value: unknown,
  declared: LanguageModelV4FunctionTool[],
): {
  tools: LanguageModelV4FunctionTool[];
  toolChoice?: LanguageModelV4ToolChoice;
} {
  const config = isRecord(value) ? value.functionCallingConfig : undefined;
  if (!isRecord(config)) return { tools: declared };
  const where = 'toolConfig.functionCallingConfig';
  if (
    config.mode !== undefined &&
    config.mode !== null &&
    typeof config.mode !== 'string'
  ) {
    throw new TranslationError(`${where}.mode must be a string`);
  }
  const mode = typeof config.mode === 'string' ? config.mode.toUpperCase() : '';
  const allowed = Array.isArray(config.allowedFunctionNames)
    ? config.allowedFunctionNames.filter(
        (name): name is string => typeof name === 'string',
      )
    : [];
  const limited =
    allowed.length > 0
      ? declared.filter((tool) => allowed.includes(tool.name))
      : declared;
  switch (mode) {
    case '':
    case 'MODE_UNSPECIFIED':
      return { tools: declared };
    case 'AUTO':
      return { tools: declared, toolChoice: { type: 'auto' } };
    case 'VALIDATED':
      return { tools: limited, toolChoice: { type: 'auto' } };
    case 'NONE':
      return { tools: declared, toolChoice: { type: 'none' } };
    case 'ANY': {
      const [only] = allowed;
      return allowed.length === 1 && only !== undefined
        ? { tools: declared, toolChoice: { type: 'tool', toolName: only } }
        : { tools: limited, toolChoice: { type: 'required' } };
    }
    default:
      throw new TranslationError(
        `${where}.mode must be AUTO, ANY, NONE or VALIDATED`,
      );
  }
}

/**
 * How hard the client asked the model to think. A level is an effort
 * already; a token budget is read as the nearest effort, 0 as no thinking,
 * and -1 (the model decides) as the provider's default.
 */
function reasoningOf(value: unknown): CallOptions['reasoning'] {
  if (value === undefined || value === null) return undefined;
  const where = 'generationConfig.thinkingConfig';
  if (!isRecord(value))
    throw new TranslationError(`${where} must be an object`);
  const level = value.thinkingLevel;
  if (level !== undefined && level !== null) {
    if (typeof level !== 'string') {
      throw new TranslationError(`${where}.thinkingLevel must be a string`);
    }
    switch (level.toUpperCase()) {
      case 'MINIMAL':
        return 'minimal';
      case 'LOW':
        return 'low';
      case 'MEDIUM':
        return 'medium';
      case 'HIGH':
        return 'high';
      case 'THINKING_LEVEL_UNSPECIFIED':
        break;
      default:
        throw new TranslationError(
          `${where}.thinkingLevel must be MINIMAL, LOW, MEDIUM or HIGH`,
        );
    }
  }
  const budget = numberAt(value, 'thinkingBudget', where);
  if (budget === undefined || budget < 0) return undefined;
  if (budget === 0) return 'none';
  return budget <= 2048 ? 'low' : budget <= 8192 ? 'medium' : 'high';
}

/** JSON output, when the client asked for it, with its schema; GenAI's
 * other output types (an enum's bare value) no other provider gives. */
function responseFormatOf(
  config: Record<string, unknown>,
  drop: Drop,
): CallOptions['responseFormat'] {
  const mime = config.responseMimeType;
  const schema = isRecord(config.responseJsonSchema)
    ? config.responseJsonSchema
    : isRecord(config.responseSchema)
      ? jsonSchemaOf(config.responseSchema)
      : undefined;
  if (mime === undefined || mime === null || mime === 'text/plain') {
    if (schema !== undefined) {
      drop(
        'response schema',
        'GenAI holds an answer to a schema only with responseMimeType application/json',
      );
    }
    return undefined;
  }
  if (mime !== 'application/json') {
    throw new TranslationError(
      `generationConfig.responseMimeType ${JSON.stringify(mime)} cannot be honoured: the model's provider answers in text or JSON`,
    );
  }
  return isJsonSchema(schema) ? { type: 'json', schema } : { type: 'json' };
}

/** The sampling and output settings of `generationConfig`. */
function generationOf(value: unknown, drop: Drop): Partial<CallOptions> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value))
    throw new TranslationError('generationConfig must be an object');
  const where = 'generationConfig';
  const options: Partial<CallOptions> = {};
  for (const key of [
    'maxOutputTokens',
    'temperature',
    'topP',
    'topK',
    'seed',
    'presencePenalty',
    'frequencyPenalty',
  ] as const) {
    const number = numberAt(value, key, where);
    if (number !== undefined) options[key] = number;
  }
  const stops = value.stopSequences;
  if (stops !== undefined && stops !== null) {
    if (
      !Array.isArray(stops) ||
      !stops.every((stop): stop is string => typeof stop === 'string')
    ) {
      throw new TranslationError(
        `${where}.stopSequences must be an array of strings`,
      );
    }
    if (stops.length > 0) options.stopSequences = stops;
  }
  const candidates = numberAt(value, 'candidateCount', where);
  if (candidates !== undefined && candidates > 1) {
    throw new TranslationError(
      `${where}.candidateCount above 1 cannot be honoured: the relay answers with one candidate`,
    );
  }
  const responseFormat = responseFormatOf(value, drop);
  if (responseFormat !== undefined) options.responseFormat = responseFormat;
  const reasoning = reasoningOf(value.thinkingConfig);
  if (reasoning !== undefined) options.reasoning = reasoning;
  for (const key of Object.keys(value)) {
    if (!GENERATION_FIELDS.has(key)) {
      drop(`${where}.${key}`, "the model's provider has no counterpart for it");
    }
  }
  return options;
}

/** A request's call: what `contents` says, under what rules. */
function parseRequest(body: Record<string, unknown>): ParsedRequest {
  const drop = dropper();
  const contents = body.contents;
  if (contents === undefined || contents === null) {
    throw new TranslationError(
      'contents is required: the conversation to answer',
    );
  }
  if (!Array.isArray(contents)) {
    throw new TranslationError('contents must be an array of turns');
  }
  if (contents.length === 0) {
    throw new TranslationError('contents must hold at least one turn');
  }
  const system = systemOf(body.systemInstruction, drop);
  const calls: Call[] = [];
  const messages = contents.flatMap((turn, index) =>
    turnMessages(turn, index, calls, drop),
  );
  if (messages.length === 0) {
    throw new TranslationError('contents says nothing: every part is empty');
  }
  const { tools, toolChoice } = toolUseOf(
    body.toolConfig,
    toolsOf(body.tools, drop),
  );
  const generation = generationOf(body.generationConfig, drop);
  for (const key of Object.keys(body)) {
    if (key === 'cachedContent') {
      drop(
        'cachedContent',
        "a context cached on Google's API cannot be honoured on the model's provider",
      );
    } else if (!REQUEST_FIELDS.has(key)) {
      drop(key, 'the relay knows no such field');
    }
  }
  return {
    options: {
      prompt:
        system === ''
          ? messages
          : [{ role: 'system', content: system }, ...messages],
      ...generation,
      ...(tools.length > 0 ? { tools } : {}),
      ...(tools.length > 0 && toolChoice !== undefined ? { toolChoice } : {}),
    },
  };
}

/** Whether the client asked to see the model's thoughts: GenAI sends them
 * only to a request whose `thinkingConfig` includes them. */
function showsThoughts(request: Record<string, unknown>): boolean {
  const config = request.generationConfig;
  return (
    isRecord(config) &&
    isRecord(config.thinkingConfig) &&
    config.thinkingConfig.includeThoughts === true
  );
}

/** A tool call as GenAI's whole `functionCall` part, or null when its input
 * is no JSON object (a call the token limit cut off): GenAI never sends a
 * call it could not complete, and the client must not run half of one. */
function functionCallOf(
  id: string,
  name: string,
  input: string,
): GenAiPayload | null {
  if (input.trim() === '') return { functionCall: { name, args: {}, id } };
  let args: unknown;
  try {
    args = JSON.parse(input);
  } catch (error) {
    console.warn(
      `[llm-relay] a call to "${name}" is left out of a GenAI answer: its input is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
  if (args === null) return { functionCall: { name, args: {}, id } };
  if (!isRecord(args)) {
    console.warn(
      `[llm-relay] a call to "${name}" is left out of a GenAI answer: its input is not a JSON object`,
    );
    return null;
  }
  return { functionCall: { name, args, id } };
}

/** A file the model made: inline as base64, or by its URL. */
function filePartOf(file: LanguageModelV4File): GenAiPayload {
  if (file.data.type === 'url') {
    return {
      fileData: { mimeType: file.mediaType, fileUri: file.data.url.href },
    };
  }
  const data = file.data.data;
  return {
    inlineData: {
      mimeType: file.mediaType,
      data:
        typeof data === 'string' ? data : Buffer.from(data).toString('base64'),
    },
  };
}

/** Why the model stopped, in GenAI's words. A call ends GenAI's turn as
 * any answer does: with STOP. */
function finishReasonOf(reason: LanguageModelV4FinishReason): string {
  switch (reason.unified) {
    case 'stop':
    case 'tool-calls':
      return 'STOP';
    case 'length':
      return 'MAX_TOKENS';
    case 'content-filter':
      return 'SAFETY';
    case 'error':
    case 'interrupted':
    case 'other':
      return 'OTHER';
    default: {
      const _exhaustive: never = reason.unified;
      return _exhaustive;
    }
  }
}

/** The sum of the counts a vendor reported, or undefined if it reported
 * none of them. */
function sumOf(...counts: (number | undefined)[]): number | undefined {
  const known = counts.filter((count) => count !== undefined);
  return known.length === 0
    ? undefined
    : known.reduce((sum, count) => sum + count, 0);
}

/**
 * The usage in GenAI's words: the prompt counts every input token, cached
 * ones included, and the candidates exclude the thoughts, which are
 * counted apart. A count the vendor never reported is left out rather than
 * said as 0 — Gemini CLI sizes its context by the prompt's — and so are the
 * cache and thought counts when there were none, as GenAI leaves them out.
 */
function usageMetadataOf(usage: LanguageModelV4Usage): Record<string, number> {
  const { inputTokens: input, outputTokens: output } = usage;
  const prompt =
    input.total ?? sumOf(input.noCache, input.cacheRead, input.cacheWrite);
  const generated = output.total ?? sumOf(output.text, output.reasoning);
  const thoughts = output.reasoning ?? 0;
  const metadata: Record<string, number> = {};
  if (prompt !== undefined) metadata.promptTokenCount = prompt;
  if (generated !== undefined) {
    metadata.candidatesTokenCount = Math.max(0, generated - thoughts);
  }
  if (prompt !== undefined || generated !== undefined) {
    metadata.totalTokenCount = (prompt ?? 0) + (generated ?? 0);
  }
  if (input.cacheRead !== undefined && input.cacheRead > 0) {
    metadata.cachedContentTokenCount = input.cacheRead;
  }
  if (thoughts > 0) metadata.thoughtsTokenCount = thoughts;
  return metadata;
}

/** One `GenerateContentResponse`: parts of the model's turn, and, on the
 * last, why it stopped and what it used. */
function responseOf(
  context: EncodeContext,
  parts: GenAiPart[],
  end?: { finishReason: string; usageMetadata: Record<string, number> },
): Record<string, unknown> {
  return {
    candidates: [
      {
        content: { parts, role: 'model' },
        ...(end === undefined ? {} : { finishReason: end.finishReason }),
        index: 0,
      },
    ],
    ...(end === undefined ? {} : { usageMetadata: end.usageMetadata }),
    modelVersion: context.model,
    responseId: context.id,
  };
}

/** A server-sent event as the Google GenAI SDK reads one: a single `data:`
 * line of JSON, no event name. */
function eventOf(body: Record<string, unknown>): string {
  return `data: ${JSON.stringify(body)}\n\n`;
}

/** A part with its carrier, when it has one. */
function carrying(part: GenAiPayload, carrier: string | undefined): GenAiPart {
  return carrier === undefined ? part : { ...part, thoughtSignature: carrier };
}

/**
 * A call's carrier: its Google signature as Google wrote it, so Gemini CLI
 * and Google read it as Google's own; or, when the call carries more (the
 * thinking right before it, another provider's fields), the relay's seal of
 * all of it.
 */
function callCarrierOf(
  thinking: Carried | undefined,
  id: string,
  carried: CarriedOptions | undefined,
): string | undefined {
  const googleOnly =
    carried === undefined ||
    Object.keys(carried).every((provider) => provider === 'google');
  if (thinking === undefined && googleOnly) {
    return carried?.google?.thoughtSignature;
  }
  return seal({
    ...thinking,
    ...(carried === undefined ? {} : { calls: { [id]: carried } }),
  });
}

/** A thinking block on its way: what the provider asked to have back with
 * it, and its text, which the provider's signature holds for. */
interface Thinking {
  options: CarriedOptions | undefined;
  text: string;
}

/**
 * The parts of the model's turn, as the SDK's parts come: the stream
 * writes each as it is made, the whole answer all of them.
 *
 * A thinking block's last thought carries the seal of what the provider
 * asked to have back with the block (an Anthropic signature, with the text
 * it signs), so it is held until the block ends and the seal is known. The
 * first part after the block carries the seal too: Gemini CLI sends no
 * thought back, so a seal on a thought alone would never return. A call
 * is written once, whole: when it arrives whole, or, when its input
 * streamed and it never did, at the end from what streamed.
 */
class TurnWriter {
  private readonly thoughts: boolean;
  private thinking: Thinking | undefined;
  /** The block's last thought, held back to carry the block's seal. */
  private held: string | undefined;
  /** What the last block carries, for the first part after it. */
  private pending: Carried | undefined;
  private readonly streaming = new Map<
    string,
    { name: string; input: string; carried: CarriedOptions | undefined }
  >();
  private readonly written = new Set<string>();

  constructor(thoughts: boolean) {
    this.thoughts = thoughts;
  }

  /** The parts one of the SDK's parts makes. */
  write(part: LanguageModelV4StreamPart): GenAiPart[] {
    switch (part.type) {
      case 'reasoning-start': {
        const ended = this.endThinking();
        this.thinking = {
          options: carriedOptions(part.providerMetadata),
          text: '',
        };
        return ended;
      }
      case 'reasoning-delta':
        return this.think(part.delta, carriedOptions(part.providerMetadata));
      case 'reasoning-end':
        return this.endThinking(carriedOptions(part.providerMetadata));
      case 'text-delta':
        return part.delta === ''
          ? []
          : [...this.endThinking(), this.after({ text: part.delta })];
      case 'file':
        return [...this.endThinking(), this.after(filePartOf(part))];
      case 'tool-input-start':
        if (part.providerExecuted !== true) {
          this.streaming.set(part.id, {
            name: part.toolName,
            input: '',
            carried: carriedOptions(part.providerMetadata),
          });
        }
        return [];
      case 'tool-input-delta': {
        const call = this.streaming.get(part.id);
        if (call !== undefined) call.input += part.delta;
        return [];
      }
      case 'tool-call':
        this.streaming.delete(part.toolCallId);
        // A call the provider ran itself is none for the client to run.
        if (part.providerExecuted === true) return [];
        return [
          ...this.endThinking(),
          ...this.call(
            part.toolCallId,
            part.toolName,
            part.input,
            carriedOptions(part.providerMetadata),
          ),
        ];
      case 'finish':
        return this.end();
      case 'error':
        // The relay turns an error part into a throw before it reaches an
        // adapter; one that does arrive ends the answer the same way.
        throw new Error('the model provider reported an error mid-stream', {
          cause: part.error,
        });
      case 'text-start':
      case 'text-end':
      case 'tool-input-end':
      case 'tool-result':
      case 'tool-approval-request':
      case 'custom':
      case 'reasoning-file':
      case 'source':
      case 'stream-start':
      case 'response-metadata':
      case 'ping':
      case 'raw':
        return [];
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }

  /** What is still held when the answer ends: the last thought, and the
   * calls whose input streamed but never arrived whole. */
  end(): GenAiPart[] {
    const parts = this.endThinking();
    for (const [id, streamed] of this.streaming) {
      parts.push(
        ...this.call(id, streamed.name, streamed.input, streamed.carried),
      );
    }
    this.streaming.clear();
    return parts;
  }

  private think(
    delta: string,
    options: CarriedOptions | undefined,
  ): GenAiPart[] {
    const thinking = this.thinking ?? { options: undefined, text: '' };
    this.thinking = {
      options: mergeCarried(thinking.options, options),
      text: thinking.text + delta,
    };
    if (!this.thoughts || delta === '') return [];
    const held = this.held;
    this.held = delta;
    return held === undefined ? [] : [{ text: held, thought: true }];
  }

  private endThinking(options?: CarriedOptions): GenAiPart[] {
    const thinking =
      this.thinking ??
      (options === undefined ? undefined : { options: undefined, text: '' });
    if (thinking === undefined) return [];
    this.thinking = undefined;
    const merged = mergeCarried(thinking.options, options);
    const carried: Carried | undefined =
      merged === undefined
        ? undefined
        : { options: merged, text: thinking.text };
    if (carried !== undefined) this.pending = carried;
    const held = this.held;
    this.held = undefined;
    return held === undefined
      ? []
      : [carrying({ text: held, thought: true }, seal(carried))];
  }

  /** A part after the thinking: it carries what the block before it
   * carries. */
  private after(part: GenAiPayload): GenAiPart {
    const carrier = seal(this.pending);
    this.pending = undefined;
    return carrying(part, carrier);
  }

  private call(
    id: string,
    name: string,
    input: string,
    carried: CarriedOptions | undefined,
  ): GenAiPart[] {
    if (this.written.has(id)) return [];
    this.written.add(id);
    const call = functionCallOf(id, name, input);
    if (call === null) return [];
    const carrier = callCarrierOf(this.pending, id, carried);
    this.pending = undefined;
    return [carrying(call, carrier)];
  }
}

/**
 * A streamed answer: a `GenerateContentResponse` per part of the model's
 * turn as it is made (GenAI streams no partial call), and a last one with
 * the finish reason and the usage.
 */
async function* encodeStream(
  parts: AsyncIterable<LanguageModelV4StreamPart>,
  context: EncodeContext,
): AsyncIterable<string> {
  const writer = new TurnWriter(showsThoughts(context.request));
  for await (const part of parts) {
    for (const written of writer.write(part)) {
      yield eventOf(responseOf(context, [written]));
    }
    if (part.type === 'finish') {
      yield eventOf(
        responseOf(context, [], {
          finishReason: finishReasonOf(part.finishReason),
          usageMetadata: usageMetadataOf(part.usage),
        }),
      );
    }
  }
}

/** A whole answer's content, as the parts a stream of it brings. */
function streamPartsOf(
  content: LanguageModelV4Content[],
): LanguageModelV4StreamPart[] {
  return content.flatMap((item, index): LanguageModelV4StreamPart[] => {
    const id = String(index);
    if (item.type === 'text') {
      return [{ type: 'text-delta', id, delta: item.text }];
    }
    if (item.type === 'reasoning') {
      return [
        { type: 'reasoning-start', id },
        { type: 'reasoning-delta', id, delta: item.text },
        {
          type: 'reasoning-end',
          id,
          ...(item.providerMetadata === undefined
            ? {}
            : { providerMetadata: item.providerMetadata }),
        },
      ];
    }
    return [item];
  });
}

/** A whole answer: one `GenerateContentResponse` with every part in order,
 * each written, and carrying, as the stream writes it. */
function encodeAnswer(
  result: LanguageModelV4GenerateResult,
  context: EncodeContext,
): Record<string, unknown> {
  const writer = new TurnWriter(showsThoughts(context.request));
  const parts = [
    ...streamPartsOf(result.content).flatMap((part) => writer.write(part)),
    ...writer.end(),
  ];
  return responseOf(context, parts, {
    finishReason: finishReasonOf(result.finishReason),
    usageMetadata: usageMetadataOf(result.usage),
  });
}

/** GenAI's in-stream error: the error body as an event, which the Google
 * GenAI SDK raises as the API's error. It names no answer, so the stream's
 * context goes unread. */
function encodeStreamError(
  kind: RelayErrorKind,
  message: string,
  _context: EncodeContext,
): string {
  return eventOf(errorBody('genai', kind, message));
}

/** The Google GenAI wire's adapter (Gemini CLI). */
export const genAiAdapter: InboundAdapter = {
  parse: parseRequest,
  encodeStream,
  encodeAnswer,
  encodeStreamError,
};

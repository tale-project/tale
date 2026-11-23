import type {
  JSONSchema7,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider';

import {
  isRecord,
  narrowStringUnion,
} from '../../../../lib/utils/type-utils.ts';
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
 * The OpenAI Chat Completions wire as its clients speak it to the relay —
 * pi, OpenCode, Hermes, OpenClaw, Qwen Code and the platform's
 * OpenAI-compatible model endpoint — translated for an upstream on another
 * wire: an Anthropic Messages connector serving a Claude model
 * (tale-project/tale#4942). A request is read into the AI SDK's call; the
 * answer is written back as `chat.completion.chunk` events, or as one
 * `chat.completion`.
 *
 * A tool loop round-trips: a later request carries the assistant's earlier
 * `tool_calls` (and the reasoning it was shown as `reasoning_content`) and
 * the `tool` messages that answer them, each read back into the SDK's parts.
 * What the provider asked to have back with its thinking and its calls (a
 * thinking signature) rides the `reasoning_details` an OpenAI-compatible
 * client repeats, sealed (`carry.ts`, {@link Carriage}).
 *
 * What the call has no place for is dropped, with one warning naming it,
 * when the answer stays right without it (log probabilities, a metadata
 * field, a storage or cache hint, OpenAI's own web search); what the answer
 * would be wrong without is refused, saying why: audio in or out, more than
 * one answer, a file stored with OpenAI, the legacy function calling.
 */

type CallOptions = ParsedRequest['options'];
type UserPart = LanguageModelV4TextPart | LanguageModelV4FilePart;
type AssistantPart = Extract<
  LanguageModelV4Message,
  { role: 'assistant' }
>['content'][number];
type ChatFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

/** What reading one request gathers on the way. */
interface Reading {
  /** Each earlier tool call's name by its id: the wire names only the call
   * a result answers, the SDK's result names its tool. */
  calls: Map<string, string>;
  /** What the request asked for that the call has no place for. */
  dropped: Set<string>;
}

/** The efforts `reasoning_effort` names, each one the SDK's own. */
const EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const present = (value: unknown): boolean =>
  value !== undefined && value !== null;

/**
 * The request fields the call has no place for, each with the values that
 * ask for something: a default that asks for nothing is dropped without a
 * word. None changes what the model is told — they tune sampling, billing,
 * storage, or a feature of OpenAI's own.
 */
const DROPPED_FIELDS: ReadonlyArray<
  readonly [field: string, asks: (value: unknown) => boolean]
> = [
  ['logprobs', (value) => value === true],
  ['top_logprobs', (value) => typeof value === 'number' && value > 0],
  ['logit_bias', (value) => isRecord(value) && Object.keys(value).length > 0],
  ['parallel_tool_calls', (value) => value === false],
  ['store', (value) => value === true],
  ['metadata', (value) => isRecord(value) && Object.keys(value).length > 0],
  ['user', (value) => typeof value === 'string' && value !== ''],
  ['safety_identifier', present],
  ['prompt_cache_key', present],
  ['prediction', present],
  [
    'service_tier',
    (value) =>
      typeof value === 'string' && !['auto', 'default'].includes(value),
  ],
  ['verbosity', present],
  ['web_search_options', present],
];

/** A number the request may leave out (or send as null). */
function optionalNumber(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TranslationError(`"${field}" must be a number.`);
  }
  return value;
}

/** A whole number of at least 1 the request may leave out. */
function optionalCount(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = optionalNumber(body, field);
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new TranslationError(
      `"${field}" must be a whole number of at least 1.`,
    );
  }
  return value;
}

/** What the call cannot carry and the answer would be wrong without. */
function refuseUncarried(body: Record<string, unknown>): void {
  const answers = optionalCount(body, 'n');
  if (answers !== undefined && answers > 1) {
    throw new TranslationError(
      '"n": this model gives one answer per request; ask for one.',
    );
  }
  const audioOut =
    Array.isArray(body.modalities) && body.modalities.includes('audio');
  if (audioOut || present(body.audio)) {
    throw new TranslationError(
      `"${audioOut ? 'modalities' : 'audio'}": this model answers in text only; audio output cannot be carried to it.`,
    );
  }
  for (const field of ['functions', 'function_call']) {
    if (present(body[field])) {
      throw new TranslationError(
        `"${field}": legacy function calling cannot be carried to this model; define the functions in "tools" and choose one with "tool_choice".`,
      );
    }
  }
}

/** A media type as IANA names it: lower case, and `image/jpg`, which some
 * clients write, as `image/jpeg`. */
function normalMediaType(type: string): string {
  const mediaType = type.trim().toLowerCase();
  return mediaType === 'image/jpg' ? 'image/jpeg' : mediaType;
}

/** The media type and base64 data of a `data:` URL, or null for any other
 * URL. */
function dataUrl(
  url: string,
  at: string,
): { mediaType: string; data: string } | null {
  if (!/^data:/i.test(url)) return null;
  const comma = url.indexOf(',');
  if (comma === -1) throw new TranslationError(`${at} is not a data URL.`);
  const [type = '', ...parameters] = url
    .slice('data:'.length, comma)
    .split(';');
  const mediaType = normalMediaType(type);
  const payload = url.slice(comma + 1);
  if (
    parameters.some((parameter) => parameter.trim().toLowerCase() === 'base64')
  ) {
    return { mediaType, data: payload };
  }
  // A data URL may carry its bytes percent-encoded rather than in base64.
  try {
    return {
      mediaType,
      data: Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64'),
    };
  } catch (error) {
    throw new TranslationError(
      `${at} is not a data URL: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

/** An image the client points at: inline data, or an http(s) address the
 * provider fetches. */
function readImage(
  part: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4FilePart {
  const image = part.image_url;
  const url = isRecord(image) ? image.url : image;
  if (typeof url !== 'string') {
    throw new TranslationError(`${at}.image_url needs its "url".`);
  }
  if (
    isRecord(image) &&
    typeof image.detail === 'string' &&
    image.detail !== 'auto'
  ) {
    reading.dropped.add('image_url.detail');
  }
  const inline = dataUrl(url, `${at}.image_url.url`);
  if (inline !== null) {
    // An image whose data URL names no type is still an image: the SDK
    // reads the exact type from its bytes.
    return {
      type: 'file',
      mediaType: inline.mediaType === '' ? 'image' : inline.mediaType,
      data: { type: 'data', data: inline.data },
    };
  }
  if (/^https?:\/\//i.test(url) && URL.canParse(url)) {
    return {
      type: 'file',
      mediaType: 'image',
      data: { type: 'url', url: new URL(url) },
    };
  }
  throw new TranslationError(
    `${at}.image_url.url must be a data: URL or an http(s) URL.`,
  );
}

/** A document the client sends inline. */
function readFile(
  part: Record<string, unknown>,
  at: string,
): LanguageModelV4FilePart {
  const file = part.file;
  if (!isRecord(file)) {
    throw new TranslationError(`${at}.file must be an object.`);
  }
  if (present(file.file_id)) {
    throw new TranslationError(
      `${at}.file.file_id: a file stored with OpenAI cannot be read by this model; send its content inline as "file_data".`,
    );
  }
  if (typeof file.file_data !== 'string') {
    throw new TranslationError(`${at}.file needs its "file_data".`);
  }
  const inline = dataUrl(file.file_data, `${at}.file.file_data`);
  if (inline === null || inline.mediaType === '') {
    throw new TranslationError(
      `${at}.file.file_data must be a data URL that names the file's type (data:<media type>;base64,…).`,
    );
  }
  return {
    type: 'file',
    mediaType: inline.mediaType,
    data: { type: 'data', data: inline.data },
    ...(typeof file.filename === 'string' && file.filename !== ''
      ? { filename: file.filename }
      : {}),
  };
}

/** Whether a text carries nothing: a provider refuses a text block that is
 * empty or only whitespace. */
function blank(text: string): boolean {
  return text.trim() === '';
}

/** One part of a user's content (or a tool result's), or null for a blank
 * text. */
function readPart(
  part: unknown,
  at: string,
  reading: Reading,
): UserPart | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    throw new TranslationError(`${at} must be a content part with a "type".`);
  }
  if (present(part.cache_control)) reading.dropped.add('cache_control');
  switch (part.type) {
    case 'text':
      if (typeof part.text !== 'string') {
        throw new TranslationError(`${at}.text must be a string.`);
      }
      return blank(part.text) ? null : { type: 'text', text: part.text };
    case 'image_url':
      return readImage(part, at, reading);
    case 'file':
      return readFile(part, at);
    case 'input_audio':
      throw new TranslationError(
        `${at}: audio input cannot be carried to this model: its provider takes no audio.`,
      );
    default:
      throw new TranslationError(
        `${at}: a "${part.type}" part cannot be carried to this model.`,
      );
  }
}

/** The texts of a content that is a string or text parts; an assistant's
 * refusal part reads as its text. */
function textsOf(
  content: unknown,
  at: string,
  reading: Reading,
  role: 'system' | 'assistant',
): string[] {
  if (content === undefined || content === null) return [];
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) {
    throw new TranslationError(
      `${at}.content must be a string or an array of parts.`,
    );
  }
  const parts: unknown[] = content;
  return parts.map((part, index) => {
    if (isRecord(part)) {
      if (present(part.cache_control)) reading.dropped.add('cache_control');
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      if (
        role === 'assistant' &&
        part.type === 'refusal' &&
        typeof part.refusal === 'string'
      ) {
        return part.refusal;
      }
    }
    throw new TranslationError(
      role === 'assistant'
        ? `${at}.content[${index}]: an assistant message takes text and refusal parts only.`
        : `${at}.content[${index}]: a system message takes text parts only.`,
    );
  });
}

/** A system or developer message: one system message per text, so the
 * client's own boundaries between them stay. */
function readSystem(
  message: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4Message[] {
  return textsOf(message.content, at, reading, 'system')
    .filter((text) => !blank(text))
    .map((text) => ({ role: 'system', content: text }));
}

function readUser(
  message: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4Message[] {
  const content = message.content;
  let parts: UserPart[];
  if (typeof content === 'string') {
    parts = blank(content) ? [] : [{ type: 'text', text: content }];
  } else if (Array.isArray(content)) {
    const raw: unknown[] = content;
    parts = raw
      .map((part, index) => readPart(part, `${at}.content[${index}]`, reading))
      .filter((part): part is UserPart => part !== null);
  } else {
    throw new TranslationError(
      `${at}.content must be a string or an array of parts.`,
    );
  }
  return parts.length === 0 ? [] : [{ role: 'user', content: parts }];
}

/** A tool call's arguments as the object they encode. Arguments that encode
 * no object are sent as `{}` rather than refused: the call already happened,
 * and its result follows. */
function toolInput(value: unknown, at: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch (error) {
      console.warn(
        `[llm-relay] ${at}.function.arguments is not JSON (${error instanceof Error ? error.message : String(error)}); the call is sent with {}`,
      );
      return {};
    }
  }
  console.warn(
    `[llm-relay] ${at}.function.arguments encode no JSON object; the call is sent with {}`,
  );
  return {};
}

/** What the relay sealed into the `reasoning_details` of an answer it wrote,
 * as the client sends it back. Entries that are not the relay's (an
 * OpenRouter answer's own) mean nothing to this model's provider: they are
 * passed over. */
function carriedBack(details: unknown): Carried[] {
  if (!Array.isArray(details)) return [];
  const entries: unknown[] = details;
  return entries.flatMap((entry) => {
    const carried =
      isRecord(entry) && isSealed(entry.data) ? unseal(entry.data) : undefined;
    return carried === undefined ? [] : [carried];
  });
}

/** The provider's fields for one call, from whichever entry carried them.
 * Only an entry's own keys count: a call named `constructor` finds nothing
 * an object inherits. */
function callOptionsOf(
  carriers: readonly Carried[],
  id: string,
): SharedV4ProviderOptions | undefined {
  for (const carried of carriers) {
    if (carried.calls !== undefined && Object.hasOwn(carried.calls, id)) {
      return providerOptionsOf(carried, id);
    }
  }
  return undefined;
}

function toolCallsOf(
  value: unknown,
  at: string,
  reading: Reading,
  carriers: readonly Carried[],
): AssistantPart[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TranslationError(`${at}.tool_calls must be an array.`);
  }
  const calls: unknown[] = value;
  return calls.map((call, index): AssistantPart => {
    const where = `${at}.tool_calls[${index}]`;
    if (!isRecord(call) || typeof call.id !== 'string' || call.id === '') {
      throw new TranslationError(`${where} needs its "id".`);
    }
    if (call.type !== undefined && call.type !== 'function') {
      throw new TranslationError(
        `${where}: only function calls can be carried to this model.`,
      );
    }
    const fn = call.function;
    if (!isRecord(fn) || typeof fn.name !== 'string' || fn.name === '') {
      throw new TranslationError(`${where}.function needs its "name".`);
    }
    reading.calls.set(call.id, fn.name);
    const part: LanguageModelV4ToolCallPart = {
      type: 'tool-call',
      toolCallId: call.id,
      toolName: fn.name,
      input: toolInput(fn.arguments, where),
    };
    const options = callOptionsOf(carriers, call.id);
    if (options !== undefined) part.providerOptions = options;
    return part;
  });
}

/** An assistant turn: the reasoning it was shown with, then its text, then
 * its tool calls. */
function readAssistant(
  message: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4Message[] {
  if (present(message.function_call)) {
    throw new TranslationError(
      `${at}.function_call: legacy function calling cannot be carried to this model; send the call in "tool_calls".`,
    );
  }
  if (present(message.audio)) {
    throw new TranslationError(
      `${at}.audio: an audio answer cannot be carried to this model, which answers in text only.`,
    );
  }
  const content: AssistantPart[] = [];
  const carriers = carriedBack(message.reasoning_details);
  // The reasoning the client was shown, sent back the DeepSeek way.
  const reasoning = [message.reasoning_content, message.reasoning].find(
    (text): text is string => typeof text === 'string' && text !== '',
  );
  let signed = false;
  for (const carried of carriers) {
    const options = providerOptionsOf(carried);
    if (options === undefined) continue;
    // A signature holds only for the text it signed: the text sealed with
    // it, rather than the client's copy (which pi does not even send back
    // once it holds the entries).
    content.push({
      type: 'reasoning',
      text: carried.text ?? reasoning ?? '',
      providerOptions: options,
    });
    signed = true;
  }
  if (!signed && reasoning !== undefined) {
    content.push({ type: 'reasoning', text: reasoning });
  }
  const texts = textsOf(message.content, at, reading, 'assistant');
  if (typeof message.refusal === 'string') texts.push(message.refusal);
  for (const text of texts) {
    if (!blank(text)) content.push({ type: 'text', text });
  }
  content.push(...toolCallsOf(message.tool_calls, at, reading, carriers));
  return content.length === 0 ? [] : [{ role: 'assistant', content }];
}

/** A tool result's content: text, or parts (text, and the images a client
 * returns from a tool). */
function toolOutput(
  content: unknown,
  at: string,
  reading: Reading,
): LanguageModelV4ToolResultOutput {
  if (content === undefined || content === null) {
    return { type: 'text', value: '' };
  }
  if (typeof content === 'string') return { type: 'text', value: content };
  if (!Array.isArray(content)) {
    throw new TranslationError(
      `${at}.content must be a string or an array of parts.`,
    );
  }
  const raw: unknown[] = content;
  const value = raw
    .map((part, index) => readPart(part, `${at}.content[${index}]`, reading))
    .filter((part): part is UserPart => part !== null);
  return value.length === 0
    ? { type: 'text', value: '' }
    : { type: 'content', value };
}

/** A tool message: the result of one earlier call, named after it. */
function readToolResult(
  message: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4Message[] {
  const id = message.tool_call_id;
  if (typeof id !== 'string' || id === '') {
    throw new TranslationError(`${at} needs its "tool_call_id".`);
  }
  // A result whose call is not in the request (a client that trimmed its
  // history) keeps the name the client gave it, if any: the upstream judges
  // the orphan.
  const toolName =
    reading.calls.get(id) ??
    (typeof message.name === 'string' ? message.name : '');
  return [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: id,
          toolName,
          output: toolOutput(message.content, at, reading),
        },
      ],
    },
  ];
}

function readMessage(
  message: unknown,
  at: string,
  reading: Reading,
): LanguageModelV4Message[] {
  if (!isRecord(message) || typeof message.role !== 'string') {
    throw new TranslationError(`${at} must be a message with a "role".`);
  }
  if (typeof message.name === 'string' && message.role !== 'tool') {
    reading.dropped.add('messages[].name');
  }
  switch (message.role) {
    case 'system':
    case 'developer':
      return readSystem(message, at, reading);
    case 'user':
      return readUser(message, at, reading);
    case 'assistant':
      return readAssistant(message, at, reading);
    case 'tool':
      return readToolResult(message, at, reading);
    case 'function':
      throw new TranslationError(
        `${at}: the legacy "function" role cannot be carried to this model; answer a tool call with a "tool" message.`,
      );
    default:
      throw new TranslationError(
        `${at}: "${message.role}" is not a Chat Completions role.`,
      );
  }
}

/** Any object the client sends as a JSON Schema: the provider judges it. */
function isSchema(value: unknown): value is JSONSchema7 {
  return isRecord(value);
}

/** A tool's input schema. A tool that takes no arguments may come without
 * one, and an upstream refuses a tool whose schema is no object (Qwen Code's
 * parameterless tools were, tale-project/tale#5353): it gets the empty
 * object schema. */
function inputSchemaOf(value: unknown, at: string): JSONSchema7 {
  if (
    value === undefined ||
    value === null ||
    (isRecord(value) && Object.keys(value).length === 0)
  ) {
    return { type: 'object', properties: {} };
  }
  if (!isSchema(value)) {
    throw new TranslationError(`${at} must be a JSON Schema object.`);
  }
  return value;
}

function readTools(value: unknown): LanguageModelV4FunctionTool[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new TranslationError('"tools" must be an array.');
  }
  const tools: unknown[] = value;
  return tools.map((tool, index): LanguageModelV4FunctionTool => {
    const at = `tools[${index}]`;
    if (!isRecord(tool)) throw new TranslationError(`${at} must be an object.`);
    if (tool.type !== undefined && tool.type !== 'function') {
      throw new TranslationError(
        `${at}: only function tools can be carried to this model${typeof tool.type === 'string' ? `, not a "${tool.type}" tool` : ''}.`,
      );
    }
    const fn = tool.function;
    if (!isRecord(fn) || typeof fn.name !== 'string' || fn.name === '') {
      throw new TranslationError(`${at}.function needs its "name".`);
    }
    const definition: LanguageModelV4FunctionTool = {
      type: 'function',
      name: fn.name,
      inputSchema: inputSchemaOf(fn.parameters, `${at}.function.parameters`),
    };
    if (typeof fn.description === 'string') {
      definition.description = fn.description;
    }
    if (typeof fn.strict === 'boolean') definition.strict = fn.strict;
    return definition;
  });
}

function readToolChoice(value: unknown): LanguageModelV4ToolChoice | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'auto' || value === 'none' || value === 'required') {
    return { type: value };
  }
  if (
    isRecord(value) &&
    value.type === 'function' &&
    isRecord(value.function) &&
    typeof value.function.name === 'string' &&
    value.function.name !== ''
  ) {
    return { type: 'tool', toolName: value.function.name };
  }
  throw new TranslationError(
    '"tool_choice" must be "auto", "none", "required" or {"type": "function", "function": {"name": …}}.',
  );
}

function readStop(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list: unknown[] = Array.isArray(value) ? value : [value];
  if (!list.every((stop): stop is string => typeof stop === 'string')) {
    throw new TranslationError(
      '"stop" must be a string or an array of strings.',
    );
  }
  const stops = list.filter((stop) => stop !== '');
  return stops.length === 0 ? undefined : stops;
}

function readResponseFormat(value: unknown): CallOptions['responseFormat'] {
  if (value === undefined || value === null) return undefined;
  const type = isRecord(value) ? value.type : undefined;
  switch (type) {
    case 'text':
      return { type: 'text' };
    case 'json_object':
      return { type: 'json' };
    case 'json_schema': {
      const spec = isRecord(value) ? value.json_schema : undefined;
      if (!isRecord(spec)) {
        throw new TranslationError(
          '"response_format.json_schema" must be an object.',
        );
      }
      return {
        type: 'json',
        ...(isSchema(spec.schema) ? { schema: spec.schema } : {}),
        ...(typeof spec.name === 'string' ? { name: spec.name } : {}),
        ...(typeof spec.description === 'string'
          ? { description: spec.description }
          : {}),
      };
    }
    default:
      throw new TranslationError(
        '"response_format" must be of type "text", "json_object" or "json_schema".',
      );
  }
}

function readReasoning(value: unknown): CallOptions['reasoning'] {
  if (value === undefined || value === null) return undefined;
  const effort =
    typeof value === 'string' ? narrowStringUnion(value, EFFORTS) : undefined;
  if (effort === undefined) {
    throw new TranslationError(
      `"reasoning_effort" must be one of ${EFFORTS.map((name) => `"${name}"`).join(', ')}.`,
    );
  }
  return effort;
}

/** The call a Chat Completions request asks for. */
function parse(body: Record<string, unknown>): ParsedRequest {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new TranslationError('"messages" must be a non-empty array.');
  }
  refuseUncarried(body);
  const reading: Reading = { calls: new Map(), dropped: new Set() };
  const messages: unknown[] = body.messages;
  const options: CallOptions = {
    prompt: messages.flatMap((message, index) =>
      readMessage(message, `messages[${index}]`, reading),
    ),
  };

  const tools = readTools(body.tools);
  if (tools !== undefined && tools.length > 0) options.tools = tools;
  const toolChoice = readToolChoice(body.tool_choice);
  if (toolChoice !== undefined) options.toolChoice = toolChoice;
  // `max_tokens` is the older name: the newer one wins when both come.
  const maxCompletionTokens = optionalCount(body, 'max_completion_tokens');
  const maxTokens = optionalCount(body, 'max_tokens');
  const maxOutputTokens = maxCompletionTokens ?? maxTokens;
  if (maxOutputTokens !== undefined) options.maxOutputTokens = maxOutputTokens;
  const temperature = optionalNumber(body, 'temperature');
  if (temperature !== undefined) options.temperature = temperature;
  const topP = optionalNumber(body, 'top_p');
  if (topP !== undefined) options.topP = topP;
  // Not OpenAI's, but sent by clients of servers that take it.
  const topK = optionalNumber(body, 'top_k');
  if (topK !== undefined) options.topK = topK;
  const stopSequences = readStop(body.stop);
  if (stopSequences !== undefined) options.stopSequences = stopSequences;
  const presencePenalty = optionalNumber(body, 'presence_penalty');
  if (presencePenalty !== undefined) options.presencePenalty = presencePenalty;
  const frequencyPenalty = optionalNumber(body, 'frequency_penalty');
  if (frequencyPenalty !== undefined) {
    options.frequencyPenalty = frequencyPenalty;
  }
  const seed = optionalNumber(body, 'seed');
  if (seed !== undefined) {
    if (!Number.isInteger(seed)) {
      throw new TranslationError('"seed" must be a whole number.');
    }
    options.seed = seed;
  }
  const responseFormat = readResponseFormat(body.response_format);
  if (responseFormat !== undefined) options.responseFormat = responseFormat;
  const reasoning = readReasoning(body.reasoning_effort);
  if (reasoning !== undefined) options.reasoning = reasoning;

  for (const [field, asks] of DROPPED_FIELDS) {
    if (asks(body[field])) reading.dropped.add(field);
  }
  if (reading.dropped.size > 0) {
    console.warn(
      `[llm-relay] a Chat Completions request asked for what its model's provider cannot take; dropped: ${[...reading.dropped].join(', ')}`,
    );
  }
  return { options };
}

/** One server-sent event that carries `data` as JSON. */
function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** The answer's id on the wire. */
function answerId(context: EncodeContext): string {
  return `chatcmpl-${context.id}`;
}

/** What every chunk (or the whole answer) of one call opens with. */
function head(context: EncodeContext, object: string) {
  return {
    id: answerId(context),
    object,
    created: context.created,
    model: context.model,
  };
}

/** The wire's finish reason: the SDK's other endings (an error, an
 * interruption) read as a stop, the only other one the wire has. */
function finishReasonOf(reason: LanguageModelV4FinishReason): ChatFinishReason {
  switch (reason.unified) {
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    case 'stop':
    case 'error':
    case 'interrupted':
    case 'other':
      return 'stop';
    default: {
      const _exhaustive: never = reason.unified;
      return _exhaustive;
    }
  }
}

/** The usage in the wire's shape: the prompt counts every input token, the
 * cached reads among them as `cached_tokens`. */
function usageOf(usage: LanguageModelV4Usage): Record<string, unknown> {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const prompt =
    input.total ??
    (input.noCache ?? 0) + (input.cacheRead ?? 0) + (input.cacheWrite ?? 0);
  const completion =
    output.total ?? (output.text ?? 0) + (output.reasoning ?? 0);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: input.cacheRead ?? 0 },
    completion_tokens_details: { reasoning_tokens: output.reasoning ?? 0 },
  };
}

/** Whether the client asked for the closing usage chunk. */
function asksUsage(request: Record<string, unknown>): boolean {
  return (
    isRecord(request.stream_options) &&
    request.stream_options.include_usage === true
  );
}

/** The format the relay's own `reasoning_details` entries name. */
const CARRIER_FORMAT = 'tale-relay-v1';

/** A thinking part of the answer, as its carrier needs it. */
interface Thought {
  /** Its text as the provider wrote it. */
  text: string;
  options: CarriedOptions | undefined;
  /** The first call that followed it, which its entry is named after. */
  before: string | undefined;
}

/**
 * What an answer asks to have back, gathered as its parts come, and
 * written as OpenRouter-style `reasoning_details` entries: one
 * `reasoning.encrypted` entry per thinking part that carries something,
 * sealed with the text it was signed with and named after the first call
 * that followed it (the answer, when none did). The calls' own fields ride
 * the last entry, or an entry of their own when no thinking carries
 * anything. Each thinking part keeps an entry of its own, since a merged
 * text would hold none of the signatures.
 *
 * pi's model library (pi-ai, which OpenClaw runs on too) keeps every
 * `reasoning.encrypted` entry, from whichever chunk, and sends the entries
 * back on the assistant message — in place of `reasoning_content`, so the
 * thinking comes back in the seal alone. A client that drops what it does
 * not know (OpenCode, through the AI SDK's OpenAI-compatible client) loses
 * the carrier: its thinking comes back unsigned, and the provider leaves it
 * out.
 */
class Carriage {
  private readonly thoughts = new Map<string, Thought>();
  private readonly calls = new Map<string, CarriedOptions>();
  private readonly seen = new Set<string>();
  private firstCall: string | undefined;

  /** A thinking part began, went on or ended: each can say part of what
   * it carries (Anthropic's signature comes with its last delta). */
  think(id: string, metadata: unknown, text = ''): void {
    const thought = this.thoughts.get(id) ?? {
      text: '',
      options: undefined,
      before: undefined,
    };
    thought.text += text;
    thought.options = mergeCarried(thought.options, carriedOptions(metadata));
    this.thoughts.set(id, thought);
  }

  /** A call began, or came whole: the first after a thinking part names
   * its entry. */
  call(id: string, metadata: unknown): void {
    if (!this.seen.has(id)) {
      this.seen.add(id);
      this.firstCall ??= id;
      for (const thought of this.thoughts.values()) thought.before ??= id;
    }
    const options = carriedOptions(metadata);
    if (options !== undefined) {
      this.calls.set(id, mergeCarried(this.calls.get(id), options) ?? options);
    }
  }

  /** The entries, in the order of the thinking they carry; none when the
   * answer asks for nothing back. `answer` is the answer's id, for an entry
   * no call followed. */
  entries(answer: string): Record<string, unknown>[] {
    const stretches: { id: string; carried: Carried }[] = [];
    for (const thought of this.thoughts.values()) {
      if (thought.options === undefined) continue;
      stretches.push({
        id: thought.before ?? answer,
        carried: { options: thought.options, text: thought.text },
      });
    }
    if (this.calls.size > 0) {
      const calls = Object.fromEntries(this.calls);
      const last = stretches.at(-1);
      if (last !== undefined) last.carried.calls = calls;
      else stretches.push({ id: this.firstCall ?? answer, carried: { calls } });
    }
    const entries: Record<string, unknown>[] = [];
    for (const { id, carried } of stretches) {
      const data = seal(carried);
      if (data === undefined) continue;
      entries.push({
        type: 'reasoning.encrypted',
        id,
        format: CARRIER_FORMAT,
        index: entries.length,
        data,
      });
    }
    return entries;
  }
}

/**
 * The answer as Chat Completions chunks: the assistant's role first, then
 * its text (`content`), reasoning (`reasoning_content`) and tool calls as
 * they come, then the finish reason, the usage when the client asked for
 * it, and `[DONE]`.
 */
async function* encodeStream(
  parts: AsyncIterable<LanguageModelV4StreamPart>,
  context: EncodeContext,
): AsyncIterable<string> {
  const chunk = (
    delta: Record<string, unknown>,
    finishReason: ChatFinishReason | null = null,
  ) =>
    sse({
      ...head(context, 'chat.completion.chunk'),
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
  yield chunk({ role: 'assistant', content: '' });
  // Each tool call the client was shown, by the SDK's id: its index on the
  // wire (the answer's calls counted from 0), and the arguments sent so far.
  const calls = new Map<string, { index: number; sent: string }>();
  // Calls the provider runs itself: the client neither runs nor sees them.
  const hidden = new Set<string>();
  const carriage = new Carriage();
  for await (const part of parts) {
    switch (part.type) {
      case 'text-delta':
        if (part.delta !== '') yield chunk({ content: part.delta });
        break;
      case 'reasoning-start':
      case 'reasoning-end':
        carriage.think(part.id, part.providerMetadata);
        break;
      case 'reasoning-delta':
        carriage.think(part.id, part.providerMetadata, part.delta);
        // A thinking block's signature comes as an empty delta.
        if (part.delta !== '') yield chunk({ reasoning_content: part.delta });
        break;
      case 'tool-input-start': {
        if (part.providerExecuted === true) {
          hidden.add(part.id);
          break;
        }
        if (calls.has(part.id)) break;
        carriage.call(part.id, part.providerMetadata);
        const index = calls.size;
        calls.set(part.id, { index, sent: '' });
        yield chunk({
          tool_calls: [
            {
              index,
              id: part.id,
              type: 'function',
              function: { name: part.toolName, arguments: '' },
            },
          ],
        });
        break;
      }
      case 'tool-input-delta': {
        const call = calls.get(part.id);
        if (call === undefined || part.delta === '') break;
        call.sent += part.delta;
        yield chunk({
          tool_calls: [
            { index: call.index, function: { arguments: part.delta } },
          ],
        });
        break;
      }
      case 'tool-call': {
        if (part.providerExecuted === true || hidden.has(part.toolCallId)) {
          break;
        }
        carriage.call(part.toolCallId, part.providerMetadata);
        const call = calls.get(part.toolCallId);
        if (call === undefined) {
          // A call the SDK gives only whole: one chunk carries all of it.
          const index = calls.size;
          calls.set(part.toolCallId, { index, sent: part.input });
          yield chunk({
            tool_calls: [
              {
                index,
                id: part.toolCallId,
                type: 'function',
                function: { name: part.toolName, arguments: part.input },
              },
            ],
          });
        } else if (
          part.input !== call.sent &&
          part.input.startsWith(call.sent)
        ) {
          // What the deltas left out: a call without arguments streams none,
          // and is whole as `{}`.
          const rest = part.input.slice(call.sent.length);
          call.sent = part.input;
          yield chunk({
            tool_calls: [{ index: call.index, function: { arguments: rest } }],
          });
        }
        break;
      }
      case 'finish': {
        // The carrier goes last, once every call it may name has come and
        // brought its own fields; a client keeps it from whichever chunk.
        const details = carriage.entries(answerId(context));
        yield chunk(
          details.length > 0 ? { reasoning_details: details } : {},
          finishReasonOf(part.finishReason),
        );
        if (asksUsage(context.request)) {
          yield sse({
            ...head(context, 'chat.completion.chunk'),
            choices: [],
            usage: usageOf(part.usage),
          });
        }
        break;
      }
      default:
        // Stream and response metadata, sources, files, raw chunks: nothing
        // the wire shows.
        break;
    }
  }
  yield 'data: [DONE]\n\n';
}

/** The answer as one `chat.completion`. */
function encodeAnswer(
  result: LanguageModelV4GenerateResult,
  context: EncodeContext,
): Record<string, unknown> {
  let text = '';
  let reasoning = '';
  const toolCalls: Record<string, unknown>[] = [];
  const carriage = new Carriage();
  for (const [index, part] of result.content.entries()) {
    switch (part.type) {
      case 'text':
        text += part.text;
        break;
      case 'reasoning':
        reasoning += part.text;
        carriage.think(String(index), part.providerMetadata, part.text);
        break;
      case 'tool-call':
        if (part.providerExecuted !== true) {
          carriage.call(part.toolCallId, part.providerMetadata);
          toolCalls.push({
            id: part.toolCallId,
            type: 'function',
            function: { name: part.toolName, arguments: part.input },
          });
        }
        break;
      default:
        break;
    }
  }
  const details = carriage.entries(answerId(context));
  return {
    ...head(context, 'chat.completion'),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text === '' && toolCalls.length > 0 ? null : text,
          ...(reasoning !== '' ? { reasoning_content: reasoning } : {}),
          ...(details.length > 0 ? { reasoning_details: details } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReasonOf(result.finishReason),
      },
    ],
    usage: usageOf(result.usage),
  };
}

/** A broken stream's last event: the error, in the wire's error shape,
 * which names no answer (the context goes unread). */
function encodeStreamError(
  kind: RelayErrorKind,
  message: string,
  _context: EncodeContext,
): string {
  return sse(errorBody('openai-chat', kind, message));
}

/** The Chat Completions wire's adapter: its clients' requests read into the
 * SDK's call, the model's answer written back in their wire. */
export const openAiChatAdapter: InboundAdapter = {
  parse,
  encodeStream,
  encodeAnswer,
  encodeStreamError,
};

import type {
  JSONSchema7,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4StreamPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';

import {
  isRecord,
  narrowStringUnion,
} from '../../../../lib/utils/type-utils.ts';
import { sanitizeError } from '../../../core/lib/utils/sanitize_secrets.ts';
import { errorBody, type RelayErrorKind } from '../wires.ts';
import {
  type Carried,
  type CarriedOptions,
  carriedOptions,
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
 * The OpenAI Responses API as Codex speaks it to the relay, translated for
 * an upstream that does not serve it: an Anthropic Messages endpoint or a
 * Chat Completions connector (tale-project/tale#4942). An upstream that
 * serves the Responses API is called on it as the client wrote it
 * (`passthrough.ts`); this adapter is for the rest.
 *
 * The relay keeps no response, so a request carries its whole conversation:
 * one that continues a stored response (`previous_response_id`), a stored
 * conversation or a stored prompt is refused. Codex sends `store: false` and
 * its whole history anyway, and runs its tool loop on it: a later request
 * replays the model's earlier `function_call` and `custom_tool_call` items,
 * their outputs and its `reasoning` items, each read back into the SDK's
 * parts.
 *
 * A `custom` tool (free-form input, such as Codex's `apply_patch`) has no
 * counterpart on another wire: it is offered as a function that takes its
 * whole input as one string, `input`, and the model's calls to it go back
 * to the client as `custom_tool_call` items carrying that string.
 *
 * A reasoning item's `encrypted_content` is opaque to the client, which
 * sends it back unread: the relay seals there what a provider asked to have
 * back (`carry.ts`) with the reasoning (Anthropic's signature on its
 * thinking, with the text it signed) and with the calls that follow it
 * (Google's thought signature on a call). A call whose fields come when no
 * reasoning item can still take them gets a reasoning item of its own, with
 * an empty summary, written just before it. `encrypted_content` the relay
 * did not write (OpenAI's own) means nothing to another provider and is
 * dropped.
 *
 * What the call has no place for is dropped, with one warning naming it,
 * when the answer stays right without it (a tool OpenAI runs itself, an item
 * only such a tool makes, a hint); what the answer would be wrong without is
 * refused, saying why: a file stored with OpenAI, the output of a call the
 * relay could not carry.
 */

type CallOptions = ParsedRequest['options'];
type UserPart = LanguageModelV4TextPart | LanguageModelV4FilePart;
type AssistantPart = Extract<
  LanguageModelV4Message,
  { role: 'assistant' }
>['content'][number];
type ToolPart = Extract<
  LanguageModelV4Message,
  { role: 'tool' }
>['content'][number];

/** What reading one request gathers on the way. */
interface Reading {
  /** Each earlier call's tool name by its `call_id`: an output names only
   * the call it answers, the SDK's result names its tool. */
  calls: Map<string, string>;
  /** The `call_id`s of the calls the relay dropped, with their item type:
   * the output that answers one cannot be carried either. */
  droppedCalls: Map<string, string>;
  /** What an earlier reasoning item carried for a call, by the call's
   * `call_id`. */
  carried: Map<string, Carried>;
  /** What the request asked for that the call has no place for. */
  dropped: Set<string>;
}

/** The efforts `reasoning.effort` names, each one the SDK's own. */
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

/** A number the request may leave out (or send as null). */
function optionalNumber(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  if (!present(value)) return undefined;
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

/** What only a provider that keeps responses can answer: the relay keeps
 * none, and the conversation they stand for would be missing. */
function refuseStored(body: Record<string, unknown>): void {
  const asked = (value: unknown) => present(value) && value !== '';
  if (asked(body.previous_response_id)) {
    throw new TranslationError(
      '"previous_response_id": the relay keeps no responses, so it cannot continue one; send the whole conversation in "input".',
    );
  }
  if (asked(body.conversation)) {
    throw new TranslationError(
      '"conversation": the relay keeps no conversations; send the whole conversation in "input".',
    );
  }
  if (asked(body.prompt)) {
    throw new TranslationError(
      '"prompt": a prompt stored with OpenAI cannot be read by this model; send its text in "instructions" and "input".',
    );
  }
  if (body.background === true) {
    throw new TranslationError(
      '"background": the relay answers while the client waits and keeps no response to poll; send the request without it.',
    );
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
  if (!url.startsWith('data:')) return null;
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

/** An `input_image`: inline data, or an http(s) address the provider
 * fetches. */
function readImage(
  part: Record<string, unknown>,
  at: string,
  reading: Reading,
): LanguageModelV4FilePart {
  if (present(part.file_id)) {
    throw new TranslationError(
      `${at}.file_id: an image stored with OpenAI cannot be read by this model; send it as "image_url", a data: URL or an http(s) URL.`,
    );
  }
  // Chat Completions' `{ url }` shape, which some clients send here too.
  const image = part.image_url;
  const url = isRecord(image) ? image.url : image;
  if (typeof url !== 'string') {
    throw new TranslationError(`${at} needs its "image_url".`);
  }
  if (typeof part.detail === 'string' && part.detail !== 'auto') {
    reading.dropped.add('input_image.detail');
  }
  const inline = dataUrl(url, `${at}.image_url`);
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
    `${at}.image_url must be a data: URL or an http(s) URL.`,
  );
}

/** An `input_file`, sent inline. */
function readFile(
  part: Record<string, unknown>,
  at: string,
): LanguageModelV4FilePart {
  if (present(part.file_id)) {
    throw new TranslationError(
      `${at}.file_id: a file stored with OpenAI cannot be read by this model; send its content inline as "file_data".`,
    );
  }
  if (present(part.file_url)) {
    throw new TranslationError(
      `${at}.file_url: a file this model's provider would fetch by address cannot be carried to it; send its content inline as "file_data".`,
    );
  }
  if (typeof part.file_data !== 'string') {
    throw new TranslationError(`${at} needs its "file_data".`);
  }
  const inline = dataUrl(part.file_data, `${at}.file_data`);
  if (inline === null || inline.mediaType === '') {
    throw new TranslationError(
      `${at}.file_data must be a data URL that names the file's type (data:<media type>;base64,…).`,
    );
  }
  return {
    type: 'file',
    mediaType: inline.mediaType,
    data: { type: 'data', data: inline.data },
    ...(typeof part.filename === 'string' && part.filename !== ''
      ? { filename: part.filename }
      : {}),
  };
}

/** One part of a user's content (or of a tool's output), or null for an
 * empty text, which carries nothing. */
function readPart(
  part: unknown,
  at: string,
  reading: Reading,
): UserPart | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    throw new TranslationError(`${at} must be a content part with a "type".`);
  }
  switch (part.type) {
    case 'input_text':
    case 'output_text':
      if (typeof part.text !== 'string') {
        throw new TranslationError(`${at}.text must be a string.`);
      }
      return part.text === '' ? null : { type: 'text', text: part.text };
    case 'input_image':
      return readImage(part, at, reading);
    case 'input_file':
      return readFile(part, at);
    default:
      throw new TranslationError(
        `${at}: an "${part.type}" part cannot be carried to this model.`,
      );
  }
}

/** The texts of a system, developer or assistant message: its content as a
 * string, or as text parts (an assistant's refusal reads as its text). */
function textsOf(
  content: unknown,
  at: string,
  role: 'system' | 'developer' | 'assistant',
): string[] {
  if (!present(content)) return [];
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) {
    throw new TranslationError(
      `${at}.content must be a string or an array of content parts.`,
    );
  }
  const parts: unknown[] = content;
  return parts.map((part, index) => {
    if (isRecord(part)) {
      if (
        (part.type === 'input_text' || part.type === 'output_text') &&
        typeof part.text === 'string'
      ) {
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
        : `${at}.content[${index}]: a ${role} message takes text parts only.`,
    );
  });
}

/**
 * The SDK's messages, built item by item. What one side says in a row is
 * one message: an assistant's text, reasoning and tool calls one assistant
 * message, in their order, and the outputs that answer them one tool
 * message. System texts in a row are one system message, as a provider that
 * takes one system message at the start needs them.
 */
class Conversation {
  readonly messages: LanguageModelV4Message[] = [];
  private openSystem: { role: 'system'; content: string } | null = null;
  private openAssistant: AssistantPart[] | null = null;
  private openTool: ToolPart[] | null = null;

  system(text: string): void {
    this.openAssistant = null;
    this.openTool = null;
    if (this.openSystem !== null) {
      this.openSystem.content += `\n\n${text}`;
      return;
    }
    this.openSystem = { role: 'system', content: text };
    this.messages.push(this.openSystem);
  }

  user(content: UserPart[]): void {
    this.openSystem = null;
    this.openAssistant = null;
    this.openTool = null;
    this.messages.push({ role: 'user', content });
  }

  assistant(part: AssistantPart): void {
    this.openSystem = null;
    this.openTool = null;
    if (this.openAssistant === null) {
      this.openAssistant = [];
      this.messages.push({ role: 'assistant', content: this.openAssistant });
    }
    this.openAssistant.push(part);
  }

  toolResult(part: ToolPart): void {
    this.openSystem = null;
    this.openAssistant = null;
    if (this.openTool === null) {
      this.openTool = [];
      this.messages.push({ role: 'tool', content: this.openTool });
    }
    this.openTool.push(part);
  }
}

function readMessage(
  item: Record<string, unknown>,
  at: string,
  conversation: Conversation,
  reading: Reading,
): void {
  switch (item.role) {
    case 'system':
    case 'developer':
      for (const text of textsOf(item.content, at, item.role)) {
        if (text !== '') conversation.system(text);
      }
      return;
    case 'user': {
      const content = item.content;
      let parts: UserPart[];
      if (typeof content === 'string') {
        parts = content === '' ? [] : [{ type: 'text', text: content }];
      } else if (Array.isArray(content)) {
        const raw: unknown[] = content;
        parts = raw
          .map((part, index) =>
            readPart(part, `${at}.content[${index}]`, reading),
          )
          .filter((part): part is UserPart => part !== null);
      } else {
        throw new TranslationError(
          `${at}.content must be a string or an array of content parts.`,
        );
      }
      if (parts.length > 0) conversation.user(parts);
      return;
    }
    case 'assistant':
      for (const text of textsOf(item.content, at, 'assistant')) {
        // A blank text carries nothing, and a provider refuses an empty
        // block.
        if (text.trim() !== '') conversation.assistant({ type: 'text', text });
      }
      return;
    default:
      throw new TranslationError(
        `${at} needs a "role": user, assistant, system or developer.`,
      );
  }
}

/** The texts of a reasoning item's summary or content parts of the given
 * types. */
function reasoningTexts(
  value: unknown,
  types: readonly string[],
  at: string,
): string[] {
  if (!present(value)) return [];
  if (!Array.isArray(value)) {
    throw new TranslationError(`${at} must be an array.`);
  }
  const parts: unknown[] = value;
  return parts.flatMap((part) =>
    isRecord(part) &&
    typeof part.type === 'string' &&
    types.includes(part.type) &&
    typeof part.text === 'string' &&
    part.text !== ''
      ? [part.text]
      : [],
  );
}

/**
 * A reasoning item: the reasoning the client was shown (its raw content
 * when it has any, else its summary), or the text the relay sealed with
 * what the provider asked to have back, which its signature holds for.
 * What it carried for the calls after it waits for them; an item that
 * carried only that (one the relay wrote for a call) is no reasoning.
 * `encrypted_content` the relay did not write is dropped (`unseal`).
 */
function readReasoning(
  item: Record<string, unknown>,
  at: string,
  conversation: Conversation,
  reading: Reading,
): void {
  const content = reasoningTexts(
    item.content,
    ['reasoning_text', 'text'],
    `${at}.content`,
  );
  const summary = reasoningTexts(
    item.summary,
    ['summary_text'],
    `${at}.summary`,
  );
  const carried = unseal(item.encrypted_content);
  if (carried?.calls !== undefined) {
    for (const callId of Object.keys(carried.calls)) {
      reading.carried.set(callId, carried);
    }
  }
  const text =
    carried?.text ?? (content.length > 0 ? content : summary).join('\n\n');
  const providerOptions = providerOptionsOf(carried);
  if (text === '' && providerOptions === undefined) return;
  conversation.assistant({
    type: 'reasoning',
    text,
    ...(providerOptions !== undefined ? { providerOptions } : {}),
  });
}

/** A string field an item cannot do without. */
function required(item: Record<string, unknown>, field: string, at: string) {
  const value = item[field];
  if (typeof value !== 'string' || value === '') {
    throw new TranslationError(`${at} needs its "${field}".`);
  }
  return value;
}

/** A function call's arguments as the object they encode. Arguments that
 * encode no object are sent as `{}` rather than refused: the call already
 * happened, and its output follows. The warnings leave out the parser's
 * message, which quotes the arguments. */
function toolInput(value: unknown, at: string): Record<string, unknown> {
  if (!present(value) || (typeof value === 'string' && value.trim() === '')) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      console.warn(
        `[llm-relay] ${at}.arguments is not JSON; the call is sent with {}`,
      );
      return {};
    }
  }
  console.warn(
    `[llm-relay] ${at}.arguments encode no JSON object; the call is sent with {}`,
  );
  return {};
}

/** A tool's output: text, or parts (text, and the images and files a
 * client returns from a tool). An output of text parts alone is one text,
 * which every provider takes as a tool's output. */
function toolOutput(
  value: unknown,
  at: string,
  reading: Reading,
): LanguageModelV4ToolResultOutput {
  if (!present(value)) return { type: 'text', value: '' };
  if (typeof value === 'string') return { type: 'text', value };
  if (!Array.isArray(value)) {
    throw new TranslationError(
      `${at} must be a string or an array of content parts.`,
    );
  }
  const raw: unknown[] = value;
  const parts = raw
    .map((part, index) => readPart(part, `${at}[${index}]`, reading))
    .filter((part): part is UserPart => part !== null);
  if (
    parts.every((part): part is LanguageModelV4TextPart => part.type === 'text')
  ) {
    return { type: 'text', value: parts.map((part) => part.text).join('\n') };
  }
  return { type: 'content', value: parts };
}

/** A call the model made: a function's, with the object its arguments
 * encode, or a custom tool's, with its input as the one string the tool was
 * offered as a function of; and what a reasoning item before it carried for
 * it. */
function readCall(
  item: Record<string, unknown>,
  at: string,
  conversation: Conversation,
  reading: Reading,
  custom: boolean,
): void {
  const callId = required(item, 'call_id', at);
  const name = required(item, 'name', at);
  let input: Record<string, unknown>;
  if (custom) {
    if (typeof item.input !== 'string') {
      throw new TranslationError(`${at}.input must be a string.`);
    }
    input = { input: item.input };
  } else {
    input = toolInput(item.arguments, at);
  }
  reading.calls.set(callId, name);
  const providerOptions = providerOptionsOf(
    reading.carried.get(callId),
    callId,
  );
  conversation.assistant({
    type: 'tool-call',
    toolCallId: callId,
    toolName: name,
    input,
    ...(providerOptions !== undefined ? { providerOptions } : {}),
  });
}

/** An output that answers an earlier call, named after the call's tool. */
function readOutput(
  item: Record<string, unknown>,
  at: string,
  conversation: Conversation,
  reading: Reading,
): void {
  const callId = required(item, 'call_id', at);
  const toolName = reading.calls.get(callId);
  if (toolName === undefined) {
    const dropped = reading.droppedCalls.get(callId);
    // A provider refuses a tool's output without the call it answers, as
    // OpenAI does.
    throw new TranslationError(
      dropped !== undefined
        ? `${at} answers the ${dropped} "${callId}", which cannot be carried to this model: it calls a tool only OpenAI's models have.`
        : `${at} answers the call "${callId}", but no function_call or custom_tool_call before it in "input" made that call; send the call with its output.`,
    );
  }
  conversation.toolResult({
    type: 'tool-result',
    toolCallId: callId,
    toolName,
    output: toolOutput(item.output, `${at}.output`, reading),
  });
}

function readItem(
  item: unknown,
  at: string,
  conversation: Conversation,
  reading: Reading,
): void {
  if (!isRecord(item)) {
    throw new TranslationError(`${at} must be an input item (an object).`);
  }
  // A message may come without its type: the wire's short form.
  const type = item.type ?? (present(item.role) ? 'message' : undefined);
  switch (type) {
    case 'message':
      readMessage(item, at, conversation, reading);
      return;
    case 'reasoning':
      readReasoning(item, at, conversation, reading);
      return;
    case 'function_call':
      readCall(item, at, conversation, reading, false);
      return;
    case 'custom_tool_call':
      readCall(item, at, conversation, reading, true);
      return;
    case 'function_call_output':
    case 'custom_tool_call_output':
      readOutput(item, at, conversation, reading);
      return;
    default:
      if (typeof type !== 'string') {
        throw new TranslationError(`${at} needs its "type".`);
      }
      // An item only OpenAI's own tools make (a web search, a shell or
      // computer call, an MCP call), or one that points at a stored item:
      // no other provider can read it.
      if (typeof item.call_id === 'string') {
        reading.droppedCalls.set(item.call_id, type);
      }
      reading.dropped.add(`"${type}" input items`);
  }
}

/** The conversation `input` carries, after the instructions. */
function readInput(
  input: unknown,
  conversation: Conversation,
  reading: Reading,
): void {
  if (typeof input === 'string') {
    if (input !== '') conversation.user([{ type: 'text', text: input }]);
    return;
  }
  if (!Array.isArray(input)) {
    throw new TranslationError(
      '"input" must be a string or an array of input items.',
    );
  }
  const items: unknown[] = input;
  items.forEach((item, index) => {
    readItem(item, `input[${index}]`, conversation, reading);
  });
}

/** Any object the client sends as a JSON Schema: the provider judges it. */
function isSchema(value: unknown): value is JSONSchema7 {
  return isRecord(value);
}

/** A function's input schema. A function that takes no arguments may come
 * without one, and an upstream refuses a tool whose schema is no object, or
 * an object schema without its properties: it gets the empty object
 * schema. */
function inputSchemaOf(value: unknown, at: string): JSONSchema7 {
  if (!present(value) || (isRecord(value) && Object.keys(value).length === 0)) {
    return { type: 'object', properties: {} };
  }
  if (!isSchema(value)) {
    throw new TranslationError(`${at} must be a JSON Schema object.`);
  }
  return value.type === 'object' && value.properties === undefined
    ? { ...value, properties: {} }
    : value;
}

function nameOf(tool: Record<string, unknown>, at: string): string {
  return required(tool, 'name', at);
}

/** A `custom` tool as a function of one string, `input`, whose description
 * says what to write in it: free text, or text in the tool's grammar. */
function customTool(
  tool: Record<string, unknown>,
  at: string,
): LanguageModelV4FunctionTool {
  const format = isRecord(tool.format) ? tool.format : {};
  let input =
    "The tool's whole input, written as the tool reads it: plain text, not JSON.";
  if (format.type === 'grammar' && typeof format.definition === 'string') {
    const syntax = typeof format.syntax === 'string' ? `${format.syntax} ` : '';
    input += ` It must match this ${syntax}grammar:\n${format.definition}`;
  }
  return {
    type: 'function',
    name: nameOf(tool, at),
    ...(typeof tool.description === 'string'
      ? { description: tool.description }
      : {}),
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: input } },
      required: ['input'],
    },
  };
}

function readTools(
  value: unknown,
  reading: Reading,
): LanguageModelV4FunctionTool[] {
  if (!present(value)) return [];
  if (!Array.isArray(value)) {
    throw new TranslationError('"tools" must be an array.');
  }
  const tools: unknown[] = value;
  return tools.flatMap((tool, index): LanguageModelV4FunctionTool[] => {
    const at = `tools[${index}]`;
    if (!isRecord(tool) || typeof tool.type !== 'string') {
      throw new TranslationError(`${at} must be a tool with a "type".`);
    }
    switch (tool.type) {
      case 'function':
        return [
          {
            type: 'function',
            name: nameOf(tool, at),
            ...(typeof tool.description === 'string'
              ? { description: tool.description }
              : {}),
            inputSchema: inputSchemaOf(tool.parameters, `${at}.parameters`),
            ...(typeof tool.strict === 'boolean'
              ? { strict: tool.strict }
              : {}),
          },
        ];
      case 'custom':
        return [customTool(tool, at)];
      default:
        // A tool OpenAI runs itself (web search, file search, code
        // interpreter, image generation, a remote MCP server) or one only
        // its models call (a local shell, a computer).
        reading.dropped.add(`the "${tool.type}" tool`);
        return [];
    }
  });
}

/** The tool choice, and the tools an `allowed_tools` choice keeps the model
 * to: the others are not offered at all, which is the same to the model. */
function readToolChoice(value: unknown): {
  choice?: LanguageModelV4ToolChoice;
  allowed?: ReadonlySet<string>;
} {
  if (!present(value)) return {};
  if (value === 'auto' || value === 'none' || value === 'required') {
    return { choice: { type: value } };
  }
  if (isRecord(value)) {
    switch (value.type) {
      case 'function':
      case 'custom': {
        // Chat Completions' `{ function: { name } }` shape, which some
        // clients send here too.
        const name =
          typeof value.name === 'string'
            ? value.name
            : isRecord(value.function) &&
                typeof value.function.name === 'string'
              ? value.function.name
              : '';
        if (name !== '') return { choice: { type: 'tool', toolName: name } };
        break;
      }
      case 'allowed_tools': {
        const mode = value.mode ?? 'auto';
        if (
          (mode === 'auto' || mode === 'required') &&
          Array.isArray(value.tools)
        ) {
          const tools: unknown[] = value.tools;
          return {
            choice: { type: mode },
            allowed: new Set(
              tools.flatMap((tool) =>
                isRecord(tool) && typeof tool.name === 'string'
                  ? [tool.name]
                  : [],
              ),
            ),
          };
        }
        break;
      }
      default:
        if (typeof value.type === 'string') {
          throw new TranslationError(
            `"tool_choice" asks for the "${value.type}" tool, which this model's provider does not have.`,
          );
        }
    }
  }
  throw new TranslationError(
    '"tool_choice" must be "auto", "none", "required", {"type": "function", "name": …}, {"type": "custom", "name": …} or {"type": "allowed_tools", …}.',
  );
}

/** How hard the model is asked to think. An effort the SDK has no name for
 * leaves the provider's default rather than refusing a client that names a
 * newer one. */
function readEffort(
  value: unknown,
  reading: Reading,
): CallOptions['reasoning'] {
  if (!present(value)) return undefined;
  if (!isRecord(value)) {
    throw new TranslationError('"reasoning" must be an object.');
  }
  if (!present(value.effort)) return undefined;
  if (typeof value.effort !== 'string') {
    throw new TranslationError('"reasoning.effort" must be a string.');
  }
  const effort = narrowStringUnion(value.effort, EFFORTS);
  if (effort === undefined) reading.dropped.add('reasoning.effort');
  return effort;
}

function readTextFormat(
  value: unknown,
  reading: Reading,
): CallOptions['responseFormat'] {
  if (!present(value)) return undefined;
  if (!isRecord(value)) {
    throw new TranslationError('"text" must be an object.');
  }
  if (present(value.verbosity)) reading.dropped.add('text.verbosity');
  const format = value.format;
  if (!present(format)) return undefined;
  const type = isRecord(format) ? format.type : undefined;
  switch (type) {
    case 'text':
      return { type: 'text' };
    case 'json_object':
      return { type: 'json' };
    case 'json_schema':
      return isRecord(format)
        ? {
            type: 'json',
            ...(isSchema(format.schema) ? { schema: format.schema } : {}),
            ...(typeof format.name === 'string' ? { name: format.name } : {}),
            ...(typeof format.description === 'string'
              ? { description: format.description }
              : {}),
          }
        : undefined;
    default:
      throw new TranslationError(
        '"text.format" must be of type "text", "json_object" or "json_schema".',
      );
  }
}

/** The call a Responses API request asks for. */
function parse(body: Record<string, unknown>): ParsedRequest {
  refuseStored(body);
  if (!present(body.input)) {
    throw new TranslationError(
      '"input" is required: a string, or an array of input items.',
    );
  }
  const reading: Reading = {
    calls: new Map(),
    droppedCalls: new Map(),
    carried: new Map(),
    dropped: new Set(),
  };
  const conversation = new Conversation();
  if (present(body.instructions)) {
    if (typeof body.instructions !== 'string') {
      throw new TranslationError('"instructions" must be a string.');
    }
    if (body.instructions !== '') conversation.system(body.instructions);
  }
  readInput(body.input, conversation, reading);
  if (conversation.messages.every((message) => message.role === 'system')) {
    throw new TranslationError(
      '"input" carries nothing for the model to answer.',
    );
  }
  const options: CallOptions = { prompt: conversation.messages };

  const { choice, allowed } = readToolChoice(body.tool_choice);
  const tools = readTools(body.tools, reading).filter(
    (tool) => allowed === undefined || allowed.has(tool.name),
  );
  if (tools.length > 0) options.tools = tools;
  if (choice !== undefined) options.toolChoice = choice;
  const maxOutputTokens = optionalCount(body, 'max_output_tokens');
  if (maxOutputTokens !== undefined) options.maxOutputTokens = maxOutputTokens;
  const temperature = optionalNumber(body, 'temperature');
  if (temperature !== undefined) options.temperature = temperature;
  const topP = optionalNumber(body, 'top_p');
  if (topP !== undefined) options.topP = topP;
  const reasoning = readEffort(body.reasoning, reading);
  if (reasoning !== undefined) options.reasoning = reasoning;
  const responseFormat = readTextFormat(body.text, reading);
  if (responseFormat !== undefined) options.responseFormat = responseFormat;
  const topLogprobs = optionalNumber(body, 'top_logprobs');
  if (topLogprobs !== undefined && topLogprobs > 0) {
    reading.dropped.add('top_logprobs');
  }
  // `store`, `include`, `parallel_tool_calls`, `metadata`,
  // `prompt_cache_key`, `service_tier`, `truncation` and `user` ask the
  // vendor to keep, label, bill or cache the call; Codex sends them on every
  // turn, and the model's answer is the same without them.

  if (reading.dropped.size > 0) {
    console.warn(
      `[llm-relay] a Responses API request asked for what its model's provider cannot take; dropped: ${[...reading.dropped].join(', ')}`,
    );
  }
  return { options };
}

/** How an answer ended, in the response's own terms. */
type Ending =
  | { status: 'completed' }
  | { status: 'incomplete'; reason: 'max_output_tokens' | 'content_filter' }
  | { status: 'failed'; error: Record<string, unknown> };

/** The event that ends a stream with each ending. */
const LAST_EVENT: Readonly<Record<Ending['status'], string>> = {
  completed: 'response.completed',
  incomplete: 'response.incomplete',
  failed: 'response.failed',
};

/** The `code` OpenAI gives a failed response of each kind, where Codex acts
 * on it: a spent quota or an overfull context ends the turn, the rest are
 * tried again. A kind the wire has no code for names its error type. */
const FAILURE_CODES: Readonly<Partial<Record<RelayErrorKind, string>>> = {
  invalid_request: 'invalid_prompt',
  budget: 'insufficient_quota',
  rate_limit: 'rate_limit_exceeded',
  too_large: 'context_length_exceeded',
  upstream: 'server_error',
  overloaded: 'server_error',
  timeout: 'server_error',
};

/** A failed response's `error`: the wire's error object, with the code the
 * Responses API gives it. */
function failure(
  kind: RelayErrorKind,
  message: string,
): Record<string, unknown> {
  const body = errorBody('openai-responses', kind, message);
  const error = isRecord(body.error) ? body.error : { message };
  const type = typeof error.type === 'string' ? error.type : 'server_error';
  return { ...error, code: FAILURE_CODES[kind] ?? type };
}

/** The response's ending for the SDK's finish reason. A stream the
 * provider broke off, or ended on an error, failed: Codex tries the turn
 * again rather than run what may be half a tool call. */
function endingOf(reason: LanguageModelV4FinishReason): Ending {
  switch (reason.unified) {
    case 'stop':
    case 'tool-calls':
    case 'other':
      return { status: 'completed' };
    case 'length':
      return { status: 'incomplete', reason: 'max_output_tokens' };
    case 'content-filter':
      return { status: 'incomplete', reason: 'content_filter' };
    case 'error':
      return {
        status: 'failed',
        error: failure('upstream', 'The model stopped on an error.'),
      };
    case 'interrupted':
      return {
        status: 'failed',
        error: failure(
          'upstream',
          "The model's answer broke off before it ended.",
        ),
      };
    default: {
      const _exhaustive: never = reason.unified;
      return _exhaustive;
    }
  }
}

/** A token count as the wire's whole number: Codex reads each count as an
 * unsigned integer, and a closing event it cannot read is a failed turn to
 * it. */
function count(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/** The usage in the wire's shape: the input counts every input token, the
 * cached reads among them as `cached_tokens`; the output counts the
 * reasoning tokens among it. */
function usageOf(usage: LanguageModelV4Usage): Record<string, unknown> {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const inputTokens = count(
    input.total ??
      (input.noCache ?? 0) + (input.cacheRead ?? 0) + (input.cacheWrite ?? 0),
  );
  const outputTokens = count(
    output.total ?? (output.text ?? 0) + (output.reasoning ?? 0),
  );
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: count(input.cacheRead) },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: count(output.reasoning) },
    total_tokens: inputTokens + outputTokens,
  };
}

/** The response object, with the settings the request asked for echoed as
 * OpenAI echoes them. Nothing is stored. */
function responseOf(
  context: EncodeContext,
  ending: Ending | { status: 'in_progress' },
  output: readonly unknown[],
  usage: Record<string, unknown> | null,
): Record<string, unknown> {
  const request = context.request;
  const reasoning = isRecord(request.reasoning) ? request.reasoning : {};
  const text = isRecord(request.text) ? request.text : {};
  const tools: unknown[] = Array.isArray(request.tools) ? request.tools : [];
  return {
    id: `resp_${context.id}`,
    object: 'response',
    created_at: context.created,
    status: ending.status,
    error: ending.status === 'failed' ? ending.error : null,
    incomplete_details:
      ending.status === 'incomplete' ? { reason: ending.reason } : null,
    instructions:
      typeof request.instructions === 'string' ? request.instructions : null,
    max_output_tokens:
      typeof request.max_output_tokens === 'number'
        ? request.max_output_tokens
        : null,
    model: context.model,
    output,
    parallel_tool_calls: request.parallel_tool_calls !== false,
    previous_response_id: null,
    reasoning: {
      effort: reasoning.effort ?? null,
      summary: reasoning.summary ?? null,
    },
    store: false,
    temperature:
      typeof request.temperature === 'number' ? request.temperature : null,
    text: {
      ...text,
      format: isRecord(text.format) ? text.format : { type: 'text' },
    },
    tool_choice: request.tool_choice ?? 'auto',
    tools,
    top_p: typeof request.top_p === 'number' ? request.top_p : null,
    truncation: 'disabled',
    usage,
    user: typeof request.user === 'string' ? request.user : null,
    metadata: isRecord(request.metadata) ? request.metadata : {},
  };
}

/** The names of the tools a request declared `custom`: a call to one goes
 * back as a `custom_tool_call`. */
function customToolNames(request: Record<string, unknown>): Set<string> {
  const tools: unknown[] = Array.isArray(request.tools) ? request.tools : [];
  return new Set(
    tools.flatMap((tool) =>
      isRecord(tool) && tool.type === 'custom' && typeof tool.name === 'string'
        ? [tool.name]
        : [],
    ),
  );
}

/** The text a call to a custom tool carries: the model wrote it as the
 * `input` of the function the tool was offered as. A call that is not that
 * goes to the client as the model wrote it, for the tool to refuse. The
 * warnings leave out the parser's message, which quotes the input. */
function customInput(json: string): string {
  if (json.trim() === '') return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn(
      '[llm-relay] a call to a custom tool is not JSON; its input goes to the client as the model wrote it',
    );
    return json;
  }
  if (isRecord(parsed)) {
    if (typeof parsed.input === 'string') return parsed.input;
    if (Object.keys(parsed).length === 0) return '';
  }
  console.warn(
    '[llm-relay] a call to a custom tool carries no "input" string; its input goes to the client as the model wrote it',
  );
  return json;
}

/** A call's arguments as the wire's JSON text: a call without arguments is
 * `{}`. */
function argumentsOf(input: string): string {
  return input.trim() === '' ? '{}' : input;
}

const outputText = (text: string) => ({
  type: 'output_text',
  annotations: [],
  logprobs: [],
  text,
});

const summaryText = (text: string) => ({ type: 'summary_text', text });

function messageItem(
  id: string,
  status: 'in_progress' | 'completed',
  content: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return { id, type: 'message', status, content, role: 'assistant' };
}

function reasoningItem(
  id: string,
  summary: readonly Record<string, unknown>[],
  sealed?: string,
): Record<string, unknown> {
  return {
    id,
    type: 'reasoning',
    summary,
    ...(sealed !== undefined ? { encrypted_content: sealed } : {}),
  };
}

/** A call item: a `custom_tool_call` with its input for a tool the request
 * declared custom, else a `function_call` with its arguments. */
function callItem(
  call: { id: string; callId: string; name: string; custom: boolean },
  status: 'in_progress' | 'completed',
  value: string,
): Record<string, unknown> {
  return call.custom
    ? {
        id: call.id,
        type: 'custom_tool_call',
        status,
        call_id: call.callId,
        input: value,
        name: call.name,
      }
    : {
        id: call.id,
        type: 'function_call',
        status,
        arguments: value,
        call_id: call.callId,
        name: call.name,
      };
}

/** A message or reasoning item being written. */
interface OpenItem {
  index: number;
  id: string;
  text: string;
}

/** One of the SDK's reasoning blocks: the item it is written as, once it
 * has text, and what its provider asked to have back. */
interface ReasoningBlock {
  item: OpenItem | null;
  options: CarriedOptions | undefined;
}

/** A tool call being written. */
interface OpenCall {
  index: number;
  id: string;
  callId: string;
  name: string;
  /** A call to a tool the request declared `custom`. */
  custom: boolean;
  /** Whether its arguments go out as the SDK streams them: a custom tool's
   * input is held until it is whole, and so is input the SDK streams as raw
   * text rather than JSON. */
  streams: boolean;
  /** What the SDK streamed of its input so far. */
  input: string;
}

/**
 * One answer written as the Responses API streams it. Each event is counted
 * (`sequence_number`, from 0); each item has its place in the answer's
 * output (`output_index`, in the order the items were added) and an id made
 * of the call's (`msg_`, `rs_`, `fc_`, `ctc_`, then the call's id and the
 * item's index).
 */
class ResponseWriter {
  /** Set once the answer's last event is written. */
  finished = false;
  private readonly context: EncodeContext;
  private readonly custom: ReadonlySet<string>;
  private sequence = 0;
  /** How many items the answer has added. */
  private items = 0;
  /**
   * The items done, in the order they were done, which is the order a
   * client keeps them in and the closing response lists them in. It is the
   * order they were added, but for a call whose provider's fields come only
   * once it is whole: the reasoning item that carries them is added after
   * the call and done before it, so the client sends them back first.
   */
  private readonly done: Record<string, unknown>[] = [];
  /** The open text and reasoning blocks, and the calls being written, by
   * the SDK's id. A provider may give a later block an id it gave an
   * earlier one, so a block is forgotten once it ends. */
  private readonly texts = new Map<string, OpenItem>();
  private readonly reasonings = new Map<string, ReasoningBlock>();
  private readonly calls = new Map<string, OpenCall>();
  /** Calls written whole, which the SDK may name again. */
  private readonly written = new Set<string>();
  /** Calls the provider runs itself: the client neither runs nor sees
   * them. */
  private readonly hidden = new Set<string>();

  constructor(context: EncodeContext) {
    this.context = context;
    this.custom = customToolNames(context.request);
  }

  /** The events that open the answer. */
  begin(): string[] {
    const response = responseOf(
      this.context,
      { status: 'in_progress' },
      [],
      null,
    );
    return [
      this.event('response.created', { response }),
      this.event('response.in_progress', { response }),
    ];
  }

  /** The events one of the SDK's parts makes. */
  write(part: LanguageModelV4StreamPart): string[] {
    if (this.finished) return [];
    switch (part.type) {
      case 'text-delta':
        return this.text(part.id, part.delta);
      case 'text-end':
        return this.endText(part.id);
      case 'reasoning-start':
        return this.reasoning(part.id, '', part.providerMetadata);
      case 'reasoning-delta':
        return this.reasoning(part.id, part.delta, part.providerMetadata);
      case 'reasoning-end':
        return this.endReasoning(part.id, part.providerMetadata);
      case 'tool-input-start':
        if (part.providerExecuted === true) {
          this.hidden.add(part.id);
          return [];
        }
        return this.startCall(part.id, part.toolName, part.inputEncoding);
      case 'tool-input-delta':
        return this.callDelta(part.id, part.delta);
      case 'tool-call':
        return this.call(part);
      case 'finish':
        return this.finish(part.finishReason, part.usage);
      case 'error':
        // The relay turns an error part into this throw before the parts
        // reach an adapter; one that comes anyway ends the stream the same.
        throw part.error instanceof Error
          ? part.error
          : new Error(sanitizeError(part.error, 300));
      // An item opens with its first text, so an empty block makes none,
      // and a call is whole with its `tool-call` part.
      case 'text-start':
      case 'tool-input-end':
      // What a provider's own tools did and made, which the client runs
      // nothing for, and the stream's metadata, which the wire does not
      // show.
      case 'tool-result':
      case 'tool-approval-request':
      case 'custom':
      case 'file':
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

  private event(type: string, fields: Record<string, unknown>): string {
    const data = { type, sequence_number: this.sequence++, ...fields };
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private itemId(prefix: string, index: number): string {
    return `${prefix}_${this.context.id}_${index}`;
  }

  /** An item's `output_item.added`, the next index its place. */
  private added(index: number, item: Record<string, unknown>): string {
    return this.event('response.output_item.added', {
      output_index: index,
      item,
    });
  }

  /** An item's `output_item.done`, the item as the client keeps it. */
  private itemDone(index: number, item: Record<string, unknown>): string {
    this.done.push(item);
    return this.event('response.output_item.done', {
      output_index: index,
      item,
    });
  }

  /**
   * Closes the text and reasoning blocks still open, as an item opens only
   * once the one before it closed, the way OpenAI writes them: a Chat
   * Completions provider ends its text only when the stream ends, after the
   * tool calls it made. With `pending`, a reasoning block that has no text
   * yet goes too (written when its provider asked for something back).
   */
  private closeBlocks(pending = false): string[] {
    const events: string[] = [];
    for (const [id, item] of this.texts) {
      this.texts.delete(id);
      events.push(...this.closeText(item));
    }
    for (const [id, block] of this.reasonings) {
      if (block.item === null && !pending) continue;
      this.reasonings.delete(id);
      events.push(...this.closeReasoning(block));
    }
    return events;
  }

  private text(id: string, delta: string): string[] {
    if (delta === '') return [];
    const events: string[] = [];
    let item = this.texts.get(id);
    if (item === undefined) {
      events.push(...this.closeBlocks());
      const index = this.items++;
      item = { index, id: this.itemId('msg', index), text: '' };
      this.texts.set(id, item);
      events.push(
        this.added(index, messageItem(item.id, 'in_progress', [])),
        this.event('response.content_part.added', {
          item_id: item.id,
          output_index: index,
          content_index: 0,
          part: outputText(''),
        }),
      );
    }
    item.text += delta;
    events.push(
      this.event('response.output_text.delta', {
        item_id: item.id,
        output_index: item.index,
        content_index: 0,
        delta,
        logprobs: [],
      }),
    );
    return events;
  }

  private endText(id: string): string[] {
    const item = this.texts.get(id);
    if (item === undefined) return [];
    this.texts.delete(id);
    return this.closeText(item);
  }

  private closeText(item: OpenItem): string[] {
    const part = outputText(item.text);
    return [
      this.event('response.output_text.done', {
        item_id: item.id,
        output_index: item.index,
        content_index: 0,
        text: item.text,
        logprobs: [],
      }),
      this.event('response.content_part.done', {
        item_id: item.id,
        output_index: item.index,
        content_index: 0,
        part,
      }),
      this.itemDone(item.index, messageItem(item.id, 'completed', [part])),
    ];
  }

  private reasoning(id: string, delta: string, metadata: unknown): string[] {
    let block = this.reasonings.get(id);
    if (block === undefined) {
      block = { item: null, options: undefined };
      this.reasonings.set(id, block);
    }
    // Anthropic signs its thinking in a delta without text, and gives its
    // redacted thinking at the block's start.
    block.options = mergeCarried(block.options, carriedOptions(metadata));
    if (delta === '') return [];
    const events: string[] = [];
    if (block.item === null) {
      events.push(...this.closeBlocks());
      const index = this.items++;
      block.item = { index, id: this.itemId('rs', index), text: '' };
      events.push(
        this.added(index, reasoningItem(block.item.id, [])),
        this.event('response.reasoning_summary_part.added', {
          item_id: block.item.id,
          output_index: index,
          summary_index: 0,
          part: summaryText(''),
        }),
      );
    }
    block.item.text += delta;
    events.push(
      this.event('response.reasoning_summary_text.delta', {
        item_id: block.item.id,
        output_index: block.item.index,
        summary_index: 0,
        delta,
      }),
    );
    return events;
  }

  private endReasoning(id: string, metadata: unknown): string[] {
    const block = this.reasonings.get(id) ?? { item: null, options: undefined };
    this.reasonings.delete(id);
    block.options = mergeCarried(block.options, carriedOptions(metadata));
    return this.closeReasoning(block);
  }

  /** A reasoning block's last events, its item carrying what the provider
   * asked to have back with the text it shows. One without text is written
   * only when its provider asked for something back (Anthropic's redacted
   * thinking), as an item with no summary. */
  private closeReasoning(block: ReasoningBlock): string[] {
    const item = block.item;
    const sealed = seal({ options: block.options, text: item?.text });
    if (item === null) {
      if (sealed === undefined) return [];
      const index = this.items++;
      const id = this.itemId('rs', index);
      return [
        this.added(index, reasoningItem(id, [])),
        this.itemDone(index, reasoningItem(id, [], sealed)),
      ];
    }
    const part = summaryText(item.text);
    return [
      this.event('response.reasoning_summary_text.done', {
        item_id: item.id,
        output_index: item.index,
        summary_index: 0,
        text: item.text,
      }),
      this.event('response.reasoning_summary_part.done', {
        item_id: item.id,
        output_index: item.index,
        summary_index: 0,
        part,
      }),
      this.itemDone(item.index, reasoningItem(item.id, [part], sealed)),
    ];
  }

  /**
   * A reasoning item with an empty summary that carries what the provider
   * asked to have back with a call (Google's thought signature). Its fields
   * come only once the call is whole, when the reasoning before it is done
   * already: this item is done just before the call, so the client sends it
   * back first.
   */
  private carrier(callId: string, options: CarriedOptions): string[] {
    const events = this.closeBlocks();
    const index = this.items++;
    const id = this.itemId('rs', index);
    events.push(
      this.added(index, reasoningItem(id, [])),
      this.itemDone(
        index,
        reasoningItem(id, [], seal({ calls: { [callId]: options } })),
      ),
    );
    return events;
  }

  private openCall(
    callId: string,
    name: string,
    streams: boolean,
  ): { call: OpenCall; events: string[] } {
    const events = this.closeBlocks();
    const index = this.items++;
    const custom = this.custom.has(name);
    const call: OpenCall = {
      index,
      id: this.itemId(custom ? 'ctc' : 'fc', index),
      callId,
      name,
      custom,
      streams: streams && !custom,
      input: '',
    };
    this.calls.set(callId, call);
    events.push(this.added(index, callItem(call, 'in_progress', '')));
    return { call, events };
  }

  private startCall(
    callId: string,
    name: string,
    encoding: 'json' | 'text' | undefined,
  ): string[] {
    if (this.calls.has(callId) || this.written.has(callId)) return [];
    return this.openCall(callId, name, encoding !== 'text').events;
  }

  private callDelta(callId: string, delta: string): string[] {
    const call = this.calls.get(callId);
    if (call === undefined || delta === '') return [];
    call.input += delta;
    if (!call.streams) return [];
    return [
      this.event('response.function_call_arguments.delta', {
        item_id: call.id,
        output_index: call.index,
        delta,
      }),
    ];
  }

  /** A whole call: the last events of the one being streamed, or all of
   * one the SDK gives only whole, after the item that carries what its
   * provider asked to have back with it. A call already written is not
   * written again. */
  private call(part: LanguageModelV4ToolCall): string[] {
    const callId = part.toolCallId;
    if (this.hidden.has(callId) || this.written.has(callId)) return [];
    const streamed = this.calls.get(callId);
    if (streamed === undefined && part.providerExecuted === true) return [];
    const options = carriedOptions(part.providerMetadata);
    const carried = options !== undefined ? this.carrier(callId, options) : [];
    if (streamed !== undefined) {
      return [...carried, ...this.closeCall(streamed, part.input)];
    }
    const { call, events } = this.openCall(callId, part.toolName, false);
    return [...carried, ...events, ...this.closeCall(call, part.input)];
  }

  /** A call's last events, with the whole input the SDK gave (or, for a
   * call it never gave whole, what it streamed). */
  private closeCall(call: OpenCall, input: string | undefined): string[] {
    this.calls.delete(call.callId);
    this.written.add(call.callId);
    const events: string[] = [];
    if (call.custom) {
      // The input, decoded from the JSON the model wrote it in, goes out
      // once.
      const text = customInput(input ?? call.input);
      if (text !== '') {
        events.push(
          this.event('response.custom_tool_call_input.delta', {
            item_id: call.id,
            output_index: call.index,
            delta: text,
          }),
        );
      }
      events.push(
        this.event('response.custom_tool_call_input.done', {
          item_id: call.id,
          output_index: call.index,
          input: text,
        }),
        this.itemDone(call.index, callItem(call, 'completed', text)),
      );
      return events;
    }
    const args = argumentsOf(input ?? call.input);
    // What the deltas did not carry: all of it for a call that streamed
    // none as JSON, and what a whole call adds to its stream (a call without
    // arguments streams none, and is whole as `{}`).
    const rest = !call.streams
      ? args
      : args.startsWith(call.input)
        ? args.slice(call.input.length)
        : '';
    if (rest !== '') {
      events.push(
        this.event('response.function_call_arguments.delta', {
          item_id: call.id,
          output_index: call.index,
          delta: rest,
        }),
      );
    }
    events.push(
      this.event('response.function_call_arguments.done', {
        item_id: call.id,
        output_index: call.index,
        name: call.name,
        arguments: args,
      }),
      this.itemDone(call.index, callItem(call, 'completed', args)),
    );
    return events;
  }

  /** The answer's last events: every item still open closed, then the
   * whole response with its usage and its items as the client keeps
   * them. */
  private finish(
    reason: LanguageModelV4FinishReason,
    usage: LanguageModelV4Usage,
  ): string[] {
    const events = this.closeBlocks(true);
    const open = [...this.calls.values()].sort((a, b) => a.index - b.index);
    for (const call of open) events.push(...this.closeCall(call, undefined));
    const ending = endingOf(reason);
    events.push(
      this.event(LAST_EVENT[ending.status], {
        response: responseOf(this.context, ending, this.done, usageOf(usage)),
      }),
    );
    this.finished = true;
    return events;
  }
}

/**
 * The answer as the Responses API streams it: `response.created` and
 * `response.in_progress`; each output item (a message, a reasoning summary,
 * a function or custom tool call) added, streamed and done; then
 * `response.completed` with every item and the usage, or
 * `response.incomplete` (the output limit, a content filter), or
 * `response.failed` (the provider broke off).
 */
async function* encodeStream(
  parts: AsyncIterable<LanguageModelV4StreamPart>,
  context: EncodeContext,
): AsyncIterable<string> {
  const writer = new ResponseWriter(context);
  yield* writer.begin();
  for await (const part of parts) {
    yield* writer.write(part);
    if (writer.finished) return;
  }
  throw new Error("the model's stream ended before it finished");
}

/** One item of a whole answer before it has its place: a reasoning item
 * seals what the calls after it carry, known once they are read. */
type AnswerItem =
  | { kind: 'message'; text: string }
  | { kind: 'reasoning'; text: string; carried: Carried }
  | { kind: 'call'; part: LanguageModelV4ToolCall };

/**
 * The answer as one response object, its output whole. A reasoning item
 * carries what the provider asked to have back with it and with each call
 * that follows it, up to the next reasoning item; calls that carry
 * something before any reasoning get a reasoning item with an empty
 * summary, just before the first of them, to carry it.
 */
function encodeAnswer(
  result: LanguageModelV4GenerateResult,
  context: EncodeContext,
): Record<string, unknown> {
  const custom = customToolNames(context.request);
  const items: AnswerItem[] = [];
  // What the latest reasoning item carries, which the calls after it add to.
  let carrying: Carried | undefined;
  for (const part of result.content) {
    switch (part.type) {
      case 'text':
        if (part.text !== '') items.push({ kind: 'message', text: part.text });
        break;
      case 'reasoning': {
        const options = carriedOptions(part.providerMetadata);
        if (part.text === '' && options === undefined) break;
        carrying = {
          options,
          ...(part.text !== '' ? { text: part.text } : {}),
        };
        items.push({ kind: 'reasoning', text: part.text, carried: carrying });
        break;
      }
      case 'tool-call': {
        if (part.providerExecuted === true) break;
        const options = carriedOptions(part.providerMetadata);
        if (options !== undefined) {
          if (carrying === undefined) {
            carrying = {};
            items.push({ kind: 'reasoning', text: '', carried: carrying });
          }
          carrying.calls = { ...carrying.calls, [part.toolCallId]: options };
        }
        items.push({ kind: 'call', part });
        break;
      }
      case 'tool-result':
      case 'tool-approval-request':
      case 'custom':
      case 'file':
      case 'reasoning-file':
      case 'source':
        // What a provider's own tools did and made: nothing the client runs.
        break;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }
  const output = items.map((item, index): Record<string, unknown> => {
    switch (item.kind) {
      case 'message':
        return messageItem(`msg_${context.id}_${index}`, 'completed', [
          outputText(item.text),
        ]);
      case 'reasoning':
        return reasoningItem(
          `rs_${context.id}_${index}`,
          item.text === '' ? [] : [summaryText(item.text)],
          seal(item.carried),
        );
      case 'call': {
        const isCustom = custom.has(item.part.toolName);
        return callItem(
          {
            id: `${isCustom ? 'ctc' : 'fc'}_${context.id}_${index}`,
            callId: item.part.toolCallId,
            name: item.part.toolName,
            custom: isCustom,
          },
          'completed',
          isCustom
            ? customInput(item.part.input)
            : argumentsOf(item.part.input),
        );
      }
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  });
  return responseOf(
    context,
    endingOf(result.finishReason),
    output,
    usageOf(result.usage),
  );
}

/**
 * A broken stream's last event: `response.failed`, whose `error` Codex
 * reads, naming the response the stream began. The relay hands over the
 * stream's context but not its count of events or the items it wrote, so
 * the event has no `sequence_number` and the response no output (Codex
 * reads neither).
 */
function encodeStreamError(
  kind: RelayErrorKind,
  message: string,
  context: EncodeContext,
): string {
  const type = 'response.failed';
  const response = responseOf(
    context,
    { status: 'failed', error: failure(kind, message) },
    [],
    null,
  );
  return `event: ${type}\ndata: ${JSON.stringify({ type, response })}\n\n`;
}

/** The Responses API wire's adapter: Codex's requests read into the SDK's
 * call, the model's answer written back in its wire. */
export const responsesAdapter: InboundAdapter = {
  parse,
  encodeStream,
  encodeAnswer,
  encodeStreamError,
};

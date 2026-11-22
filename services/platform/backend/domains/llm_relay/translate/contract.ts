import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';

import type { RelayErrorKind } from '../wires.ts';

/**
 * The seam between a client's wire and the AI SDK's language model, through
 * which the relay translates a call whose client and upstream speak
 * different wires (tale-project/tale#4942). Each client wire has one
 * adapter: it reads a request into the SDK's call, and writes the model's
 * answer back in the client's wire. The SDK's provider packages speak the
 * upstream's wire; nothing here knows which one it is.
 *
 * Same-wire calls never pass through here (`passthrough.ts`): translation
 * loses what one wire has and the other has not, so it is only for the
 * pairs that need it.
 */

/** A request the relay cannot translate: answered as the wire's 400 (or
 * the kind it names), before anything is sent upstream. */
export class TranslationError extends Error {
  readonly kind: RelayErrorKind;

  constructor(message: string, kind: RelayErrorKind = 'invalid_request') {
    super(message);
    this.name = 'TranslationError';
    this.kind = kind;
  }
}

/** What an adapter reads out of a client's request. */
export interface ParsedRequest {
  /**
   * The call, without what the relay adds: the abort signal, the headers
   * and the upstream's provider options. How hard the client asked the
   * model to think goes in the SDK's own `reasoning` (each provider spells
   * it on its wire): a token budget is read as the nearest effort.
   */
  options: Omit<
    LanguageModelV4CallOptions,
    'abortSignal' | 'headers' | 'providerOptions'
  >;
}

/** What an adapter is told about the answer it writes. */
export interface EncodeContext {
  /** The model name the client asked for, echoed where the wire names the
   * model. */
  model: string;
  /** An id for this call's answer, unique per call: the adapter prefixes it
   * the way its wire's ids look (`msg_`, `chatcmpl-`, `resp_`). */
  id: string;
  /** Seconds since the epoch, for the wires that stamp an answer. */
  created: number;
  /** The client's request as it came, for what the answer depends on
   * (whether it asked for a usage chunk, which of its tools were custom). */
  request: Record<string, unknown>;
}

/** One client wire's translation. */
export interface InboundAdapter {
  /** The call a request asks for. Throws {@link TranslationError} for a
   * request the wire itself would refuse, or that names a feature the
   * relay cannot carry onto another wire (the message says which). */
  parse(body: Record<string, unknown>): ParsedRequest;
  /**
   * A streamed answer in the wire's server-sent events. Each yielded string
   * is one whole event, terminator included (`data: …\n\n`), so the relay
   * passes it on as it comes. The parts end with one `finish` part, unless
   * the upstream failed: then the iterable throws, after whatever it had
   * yielded, and the relay ends the stream with {@link encodeStreamError}.
   */
  encodeStream(
    parts: AsyncIterable<LanguageModelV4StreamPart>,
    context: EncodeContext,
  ): AsyncIterable<string>;
  /** A whole answer in the wire's JSON. */
  encodeAnswer(
    result: LanguageModelV4GenerateResult,
    context: EncodeContext,
  ): Record<string, unknown>;
  /** The event that tells a client a stream broke after it began, or null
   * for a wire that has none (the stream then just ends). The context is
   * the stream's, for a wire whose error event names the answer. */
  encodeStreamError(
    kind: RelayErrorKind,
    message: string,
    context: EncodeContext,
  ): string | null;
}

// Type declarations for he (HTML entity encoder/decoder)
// These types cover only the API used by this project

declare module 'he' {
  export interface DecodeOptions {
    isAttributeValue?: boolean;
    strict?: boolean;
  }

  export interface EncodeOptions {
    useNamedReferences?: boolean;
    decimal?: boolean;
    encodeEverything?: boolean;
    strict?: boolean;
    allowUnsafeSymbols?: boolean;
  }

  export function decode(html: string, options?: DecodeOptions): string;
  export function encode(text: string, options?: EncodeOptions): string;
  export function escape(text: string): string;
  export function unescape(text: string): string;
}

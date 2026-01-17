// Type declarations for striptags (HTML tag stripper)
// These types cover only the API used by this project

declare module "striptags" {
  interface StriptagsOptions {
    allowedTags?: string[];
    tagReplacement?: string;
  }

  function striptags(
    html: string,
    allowedTags?: string[] | string,
    tagReplacement?: string
  ): string;

  function striptags(html: string, options: StriptagsOptions): string;

  export = striptags;
}

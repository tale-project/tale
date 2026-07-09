/**
 * Release shape shared with the platform changelog viewer
 * (`services/platform/convex/changelog/*`). Marketing embeds a build-time
 * snapshot; the platform scrapes GitHub HTML at runtime.
 */
export interface Release {
  tag: string;
  version: string;
  name: string | null;
  /** GitHub-flavoured Markdown body (API) or sanitized HTML (platform scrape). */
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

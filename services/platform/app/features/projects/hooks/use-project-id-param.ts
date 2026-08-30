/**
 * Narrow a `projectId` URL-param string to the branded `string`.
 *
 * TanStack Router's `useParams()` returns the raw string from the URL.
 * Convex queries and mutations want the branded ID type. The branding is
 * a structural-only TS marker (Convex validates the actual ID server-side
 * on every call); a plain `as string` is the correct, idiomatic
 * coercion here — and centralizing it here means only one place carries
 * the lint-disable comment.
 */
export function asProjectId(raw: string): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Branded Id<...> is a structural-only TS marker; Convex validates server-side on every query/mutation call.
  return raw;
}

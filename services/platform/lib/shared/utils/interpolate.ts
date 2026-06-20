/**
 * One `{placeholder}` interpolator, shared by every caller that fills a template
 * string from a params bag (notification messages, app task templates, …) so the
 * substitution rule can't drift across them. Pure + dependency-free, so both the
 * Convex layer and the frontend import the same function.
 *
 * Unknown placeholders are left verbatim (`{name}`) so a gap is visible rather
 * than silently blanked. Non-string values stringify safely (never
 * `[object Object]`). `transform` post-processes each interpolated value — e.g.
 * Slack-escaping for chat notifications; identity (the default) everywhere else.
 */
export function interpolateTemplate(
  template: string,
  params?: Record<string, unknown>,
  transform: (value: string) => string = (value) => value,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) return `{${name}}`;
    const str =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    return transform(str);
  });
}

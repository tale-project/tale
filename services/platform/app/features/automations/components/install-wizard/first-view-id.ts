/** First view id from an installed automation's `views` array (list / detail). */
export function firstViewIdFromViews(
  views: readonly { id?: string }[] | undefined,
): string | undefined {
  const id = views?.[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

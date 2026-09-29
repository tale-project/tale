/**
 * A cloud picker's listing that failed without a refusal to show: the
 * provider answered `success: false`, or there was nothing to list yet. Its
 * message is the provider's own answer — `OneDrive API error: 403 {…}`, in
 * English, often a raw JSON or HTML body — kept for the log and for the
 * dialogs' lapsed-grant check, and never put under a toast's title
 * (`useListingFailureToast`).
 */
export class CloudListingError extends Error {
  override readonly name = 'CloudListingError';
}

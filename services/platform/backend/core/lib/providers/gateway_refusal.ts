/**
 * The statuses with which a gateway refuses a request on one of its APIs when
 * it cannot serve that API for the model: no such route (404, 405, 501), a
 * route the key may not use or a front door that guards only the paths it
 * knows (401, 403), or a body it does not take (400, 415, 422). Bifrost
 * answers an images request for a model it reaches over chat alone with 400
 * or 404. Limits and outages (429, 5xx) would fail on the gateway's other API
 * just the same, and surface as they are.
 *
 * Read wherever a request falls back to the gateway's other API: a chat round
 * refused on the Responses API asks Chat Completions, and an image call
 * refused on the images API asks Chat Completions for the image.
 */
export const GATEWAY_REFUSAL_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 405, 415, 422, 501,
]);

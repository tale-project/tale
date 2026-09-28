/**
 * The caps and vocabularies every product write shares. The domain
 * service, the REST and app input schemas, the create/edit dialogs and the
 * OpenAPI document all read them from here, so the limit a door names in
 * its 400 is the limit the row is stored under — the service used to
 * carry a second copy of the same numbers.
 */

/** Maximum length of a product display name (characters). */
export const PRODUCT_NAME_MAX = 255;
/** Maximum length of a product description (characters). */
export const PRODUCT_DESCRIPTION_MAX = 4000;
/** Maximum length of a product category (characters). */
export const PRODUCT_CATEGORY_MAX = 100;
/** Maximum length of an ISO 4217 currency code (characters). */
export const PRODUCT_CURRENCY_MAX = 3;
/** Maximum length of a product image URL (characters). */
export const PRODUCT_IMAGE_URL_MAX = 2048;
/**
 * How many rows one product file import sends. The app door refuses a
 * longer list whole (`POST /api/app/products/bulk`), so the import dialog
 * checks the parsed file against the same number and asks for a split
 * before sending, instead of a 400 that names no row.
 */
export const PRODUCT_IMPORT_ROWS_MAX = 1_000;

/** `undefined` = not asked yet; `null` = the runtime cannot say. */
let iso4217Cache: ReadonlySet<string> | null | undefined;

/**
 * Every ISO 4217 currency code the runtime's ICU data knows, uppercase —
 * or `null` where the runtime has no `Intl.supportedValuesOf` (a browser
 * older than Safari 15.4), asked lazily so the module loads there too.
 * `currency` is documented as an ISO 4217 code and used to accept any three
 * characters (`ZZZ`, `123`, `$`); one set serves the door, the dialogs and
 * the OpenAPI description, with no dependency to keep current.
 */
export function iso4217Currencies(): ReadonlySet<string> | null {
  if (iso4217Cache !== undefined) return iso4217Cache;
  try {
    iso4217Cache = new Set(Intl.supportedValuesOf('currency'));
  } catch (error) {
    console.warn(
      '[products] Intl.supportedValuesOf unavailable; accepting any three-letter currency code',
      error,
    );
    iso4217Cache = null;
  }
  return iso4217Cache;
}

/** Whether `code` (any case) is an ISO 4217 currency the runtime knows;
 * where the runtime cannot list them, any three letters (the server, which
 * always can, still judges the write). */
export function isIso4217Currency(code: string): boolean {
  const upper = code.toUpperCase();
  const known = iso4217Currencies();
  return known === null ? /^[A-Z]{3}$/.test(upper) : known.has(upper);
}

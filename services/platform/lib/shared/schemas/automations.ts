/**
 * Caps for an uploaded automation package zip — the pack format's files
 * (`workflow.yml` + `automation.yml`) plus the skill bundles it carries under
 * `skills/<slug>/`. Sized like the bundle caps main shipped with: an
 * automation package is richer than a lone skill bundle (it may carry several),
 * so the entry cap is generous while the byte caps match the skill domain's
 * order of magnitude. The parser enforces them per entry and as a running
 * decompressed total, and the upload action pre-filters on the compressed blob
 * size before a single entry is inflated.
 */

/** Cap on one decompressed file inside the package zip. */
export const MAX_AUTOMATION_BUNDLE_FILE_BYTES = 2 * 1024 * 1024;

/** Cap on the package's total decompressed bytes across all files. */
export const MAX_AUTOMATION_BUNDLE_TOTAL_BYTES = 20 * 1024 * 1024;

/** Cap on the number of zip entries, counted before any content is read. */
export const MAX_AUTOMATION_BUNDLE_ENTRIES = 500;

/** Cap on the skills one package may declare and carry. */
export const MAX_PACK_SKILLS = 20;

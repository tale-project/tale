/**
 * The OCR/description seam the extractors call for embedded images.
 *
 * The 0.3 implementation lived in `../vision/client` (an LLM-backed OCR +
 * captioning client with a cache); it was retired with the AI-backend
 * rewrite and has not been rebuilt yet. The extractors keep the seam — every
 * one of them already degrades cleanly on `null` (digital text is extracted,
 * scanned pages are counted and reported, images are skipped with a warning)
 * — so ingestion runs text-only today and the vision arm can return without
 * touching the extractors.
 */
export interface VisionClient {
  /** OCR an image, returning the recognized text ('' when none). */
  ocrImage(imageBytes: Uint8Array): Promise<string>;
  /** Describe an image in prose, for indexing alongside the document text. */
  describeImage(imageBytes: Uint8Array): Promise<string>;
}

// pdfjs-dist ships no `.d.ts` for its worker entry, so importing it trips
// TS7016 under noImplicitAny. We import it only for its side effect — exposing
// `WorkerMessageHandler` so `extraction/pdf.ts` can set `globalThis.pdfjsWorker`
// and run pdfjs's worker in-process inside the Convex node action (see
// loadPdfjs). Declare the minimal shape we touch.
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}

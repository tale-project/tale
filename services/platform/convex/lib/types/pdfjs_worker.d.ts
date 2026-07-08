// The modern pdfjs-dist build ships no declaration files (only legacy/build
// has pdf.d.mts), so the modern entries loaded by `extraction/pdfjs_loader.ts`
// need ambient declarations. The API surface is identical between the two
// builds — only the transpilation target differs — so the main entry's types
// redirect to the legacy declarations.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist/legacy/build/pdf.mjs';
}

// The worker entry has no `.d.ts` in either build, so importing it trips
// TS7016 under noImplicitAny. We import it only for its side effect — exposing
// `WorkerMessageHandler` so `extraction/pdfjs_loader.ts` can set
// `globalThis.pdfjsWorker` and run pdfjs's worker in-process inside the Convex
// node action (see loadPdfjs). Declare the minimal shape we touch.
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}

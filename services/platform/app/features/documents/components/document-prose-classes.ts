import { cn } from '@/lib/utils/cn';

// `@tailwindcss/typography` is not loaded in this monorepo, so `prose` is a
// no-op and Tailwind preflight strips heading / list defaults. Style each
// element explicitly so converted document HTML (mammoth DOCX, ODT) renders
// like a document. Shared by `document-preview-docx` and
// `document-preview-odt`.
export const documentProseClasses = cn(
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:first:mt-0',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:first:mt-0',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-base [&_h4]:font-semibold',
  '[&_p]:my-2 [&_p]:leading-relaxed',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_li]:leading-relaxed',
  '[&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline',
  '[&_strong]:font-semibold',
  '[&_em]:italic',
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre]:bg-muted [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-3 [&_pre]:text-sm',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:italic',
  '[&_hr]:border-border [&_hr]:my-6',
  '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded',
  '[&_table]:my-3 [&_table]:w-auto [&_table]:max-w-full [&_table]:border-collapse',
  '[&_th]:border-border [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
);

/** Shared white "page" chrome for every in-dialog document preview. */
export const previewPageShellClasses =
  'bg-background mx-auto w-full rounded-lg border border-border/60 shadow-sm';

/** Converted DOCX/ODT HTML — centered page on a muted canvas. */
export const documentPageClasses = cn(
  previewPageShellClasses,
  'mx-auto min-h-full w-full max-w-2xl p-6',
  documentProseClasses,
);

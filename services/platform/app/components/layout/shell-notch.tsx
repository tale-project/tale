/**
 * The notch clearance of an installed iPhone app (`--safe-top`), as one strip
 * that heads the shell (`routes/dashboard/$id.tsx`), its boot frame
 * (`dashboard-shell-frame.tsx`) and a standing session notice outside the
 * shell (`session-lapse-recovery.tsx`). Nothing else pads the notch: the
 * alerts below it, the phone header and a thread page's own header start
 * under it.
 *
 * Its height never changes, so an alert that arrives after the shell has
 * painted moves the header by the alert's own height. When the header padded
 * the notch and gave its pad to the arriving alert, the header's box moved by
 * the alert and the notch together, and scored as that much layout shift. A
 * seen alert right below the strip lends it its tint; from `md` up, where the
 * shell has no header, it stands only above an alert.
 *
 * Framework-free on purpose: the boot-shell prerender renders it under plain
 * `bun`.
 */
export function ShellNotch() {
  return (
    <div
      aria-hidden
      data-shell-notch
      className="bg-background [&:has(+[data-shell-alert]:not([aria-hidden]))]:bg-warning/10 h-(--safe-top) shrink-0 md:hidden md:[&:has(+[data-shell-alert])]:block"
    />
  );
}

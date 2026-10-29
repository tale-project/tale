# Navigation & shell — boxes a spec took over

Rows for [`navigation`](../../suites/navigation.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [navigation](../../suites/navigation.md) | Desktop Home panel drag and keyboard resizing, width bounds, per-organization remembered width, and hidden handles when folded or on mobile; a lost drag stops on window blur or a released-button move and restores prior body styles; the existing Sheet still resizes from its left edge | ✅ browser | `app/features/home/components/home-panel.browser.test.tsx`, `packages/ui/src/hooks/use-resizable.browser.test.tsx` |

Scroll-responsive navigation is covered by `packages/ui/src/hooks/use-scroll-compact.test.ts` (direction thresholds, overscroll, dialog exclusion, route and keyboard resets) and `packages/ui/src/components/navigation/bottom-tab-bar.browser.test.tsx` (real nested scroll events, compact geometry, accessible names, 44px targets and stable clearance). Physical Safari/PWA scrolling remains `RESP-F22`.

A failed membership refresh over a loaded member context is not access still loading (#4859). `app/routes/dashboard/dashboard-layout.test.tsx` holds the ability-loading flag under the outlet (false through the failure, true on a first load from the last role and on a refetch that dropped its data), the shell's notice and its **Try again**, a Knowledge tab rendered through the failure, and the full-page error when nothing was loaded. `app/components/layout/access-refresh-notice.test.tsx` holds the busy retry, the repeated announcement and the focus handed to the page. A real backend failure, the browser layout and a screen reader remain `NAV-B20`.

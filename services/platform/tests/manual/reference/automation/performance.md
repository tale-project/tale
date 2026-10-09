# Performance (cross-cutting) — boxes a spec took over

Rows for [`performance`](../../suites/performance.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [performance](../../suites/performance.md) / [navigation](../../suites/navigation.md) | An overlay modal (dialog, sheet, drawer, the search palette, image zoom) pins the app root to `pointer-events: auto` from its first style pass until the body is live again, so the page under it is not restyled while its backdrop still keeps every pointer from the page; menus, selects and popovers keep the inert page. The search palette has no backdrop blur. `useFormatDate` re-renders an instance for its locale only while that locale's data was still loading, and `formatDate` skips converting into the runtime's own zone. | ✅ unit + component + real Chromium | `packages/ui/src/components/overlays/page-pointer-pin.test.tsx`, `packages/ui/src/components/dialog/modal-isolation.browser.test.tsx`, `packages/ui/src/hooks/use-format-date.test.tsx`, `packages/ui/src/lib/date/format.test.ts`; keystroke paint time without a GPU remains `PERF-P11` |

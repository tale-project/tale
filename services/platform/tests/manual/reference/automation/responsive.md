# Responsive (cross-cutting) — boxes a spec took over

Rows for [`responsive`](../../suites/responsive.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [responsive](../../suites/responsive.md) | `RESP-F20`: capsule geometry, content end clearance, floating actions, and the Home archive footer | ✅ Chromium | `packages/ui/src/components/navigation/bottom-tab-bar.browser.test.tsx`, `services/platform/tests/e2e/specs/responsive.spec.ts` |
| [responsive](../../suites/responsive.md) | `RESP-F21`: keyboard inference from editable focus and viewport contraction; hardware focus, pinch zoom, desktop transition, and missing VisualViewport support | 🔶 component; native phone verification remains manual | `packages/ui/src/hooks/use-mobile-keyboard.test.ts` |

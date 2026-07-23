// `.yml` imports resolve at build time via the shared `@tale/ui/vite/yaml`
// plugin. Typed loose on purpose — strongly-typed surfaces (the i18n message
// catalogs) derive their shapes from the generated `messages.gen.ts`.
declare module '*.yml' {
  // oxlint-disable-next-line typescript/no-explicit-any -- build-time-parsed data; typed surfaces come from generated interfaces
  const data: any;
  export default data;
}

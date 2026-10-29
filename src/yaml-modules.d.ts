/**
 * Import typing for `.yml`/`.yaml` modules, resolved at build time by the
 * shared `@tale/ui/vite/yaml` plugin into plain data. Typed loose on
 * purpose: strongly-typed surfaces (the i18n message catalogs) derive their
 * shapes from the generated `messages.gen.ts` files, never from the module
 * type.
 */
declare module '*.yml' {
  // oxlint-disable-next-line typescript/no-explicit-any -- build-time-parsed data; typed surfaces come from generated interfaces
  const data: any;
  export default data;
}

declare module '*.yaml' {
  // oxlint-disable-next-line typescript/no-explicit-any -- build-time-parsed data; typed surfaces come from generated interfaces
  const data: any;
  export default data;
}

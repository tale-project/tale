// CSS modules imported by components (e.g. the date-range picker's popper
// styles). Vite hands back the generated class map; consumers that type-check
// this package's source get the same shape here.
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

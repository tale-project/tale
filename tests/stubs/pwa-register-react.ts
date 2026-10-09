/**
 * Test stand-in for `virtual:pwa-register/react`, the module vite-plugin-pwa
 * generates in a consuming service's build. A test that renders a component
 * importing it mocks `useRegisterSW`; this stub only makes the import
 * resolvable and refuses to be used for real.
 */

export function useRegisterSW(): never {
  throw new Error(
    'virtual:pwa-register/react is a build-time module — mock useRegisterSW in the test',
  );
}

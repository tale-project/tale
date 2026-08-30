// The pure owner-id helpers now live in `external_identities_helpers.ts` (a
// function-free module) so client code can import them WITHOUT dragging these
// `internalMutation`/`internalQuery` definitions into the browser bundle (a
// convex function builder runs `assertNotBrowser()` at module-init). They are
// re-exported here so existing server importers and the test suite keep
// resolving them from this module unchanged.
export {
  buildExternalOwnerId,
  isExternalOwnerId,
} from './external_identities_helpers';

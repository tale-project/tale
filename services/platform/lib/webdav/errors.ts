// Re-export the canonical helper from its shared home so existing
// webdav/methods/* imports (`from '../errors'`) keep working unchanged.
export { backendErrorCode } from '../utils/backend-error';

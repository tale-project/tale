/**
 * Check if an operation is a system introspection operation
 */

export function isIntrospectionOperation(operationName: string): boolean {
  return operationName.startsWith('introspect_');
}

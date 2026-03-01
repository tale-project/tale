---
description: Testing requirements and best practices
activationType: model_decision
modelDecision: Apply this rule when creating new features, fixing bugs, or modifying existing functionality
---

# Testing Standards

## Test-First Approach
- BEFORE modifying existing code, ensure that adequate tests exist
- If tests are missing, write them first to lock in current behavior, then make the change
- ALWAYS write tests for new features and bug fixes

## Test Coverage
- Tests should cover:
  - ✅ Happy paths (normal, expected usage)
  - ✅ Edge cases (boundary conditions, empty inputs, etc.)
  - ✅ Error conditions (invalid inputs, failure scenarios)

## Test Execution
- Run tests after changes to confirm nothing is broken
- Use `npm run test` for JavaScript/TypeScript tests
- Use appropriate test runners for Python services

## Test Organization
- Keep tests close to the code they test
- Use descriptive test names that explain what is being tested
- Group related tests together
- Mock external dependencies appropriately

## Example Test Structure
```typescript
describe('calculateTotal', () => {
  it('should calculate total for valid items', () => {
    // Happy path
  });

  it('should return 0 for empty array', () => {
    // Edge case
  });

  it('should throw error for invalid items', () => {
    // Error condition
  });
});
```

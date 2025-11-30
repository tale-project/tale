# Variables Replacement System Design

## Overview

The variables replacement system provides a robust, two-stage template processing pipeline that combines **Mustache** for template parsing and **JEXL** for expression evaluation. This design ensures safe, reliable variable substitution in workflow templates.

## Architecture

### Two-Stage Pipeline

```
Template String
    ↓
[Stage 1: Mustache Parser]
    ↓
Token Stream (text + expressions)
    ↓
[Stage 2: JEXL Evaluator]
    ↓
Rendered String
```

## Components

### 1. Mustache Parser (`replace_variables_in_string.ts` and `replace_variables.ts`)

**Purpose**: Parse template strings into structured tokens

**Key Features**:

- Tokenizes templates using `Mustache.parse()`
- Separates plain text from variable references
- Handles edge cases: nested braces, escaping, complex syntax
- Robust and battle-tested (Mustache is a mature library)

**Token Types**:

- `text`: Plain text content (passed through as-is)
- `name`: Variable reference `{{var}}`
- `&`: Unescaped variable reference `{{{var}}}`

**Example**:

```typescript
// Input: "Hello {{name}}, you have {{count}} items"
// Tokens:
// [['text', 'Hello '], ['name', 'name'], ['text', ', you have '], ['name', 'count'], ['text', ' items']]
```

### 2. JEXL Evaluator (`evaluate_expression.ts`)

**Purpose**: Safely evaluate JavaScript-like expressions

**Key Features**:

- Sandboxed expression evaluation (no `eval()` or `Function` constructor)
- Supports complex logic: comparisons, math, ternary operators
- Custom transforms: `upper`, `lower`, `trim`, `length`, `map`, `filter`, etc.
- Type-safe with proper error handling

**Supported Operations**:

```javascript
// Comparisons
'age > 18';
'status == "active"';

// Logic
'active && verified';
'age > 18 || hasPermission';

// Math
'price * 1.1';
'(subtotal + tax) * quantity';

// Ternary
'age >= 18 ? "adult" : "minor"';

// Transforms
'name|upper';
'items|length';
'description|trim|length > 10';

// Array operations
'items[0].price > 100';
'["active", "pending"].includes(status)';
```

### 3. JEXL Instance (`jexl_instance.ts`)

**Purpose**: Configure JEXL with custom transforms for workflow use cases

**Custom Transforms**:

- **String**: `upper`, `lower`, `trim`, `length`
- **Type Conversion**: `string`, `number`, `boolean`
- **Array Operations**: `first`, `last`, `join`, `map`, `filter`, `unique`, `concat`, `find`, `sort`, `reverse`, `slice`
- **Advanced**: `parseJSON`, `formatList`, `hasOverlap`

### 4. Context Builder (`build_context.ts`)

**Purpose**: Prepare evaluation context from variables

**Features**:

- Merges nested variables
- Exposes workflow-level variables at top-level (backward compatibility)
- Adds built-in values like `now` (current ISO timestamp)

### 5. Template Validator (`validate_template.ts`)

**Purpose**: Validate template syntax before execution

**Features**:

- Extracts all `{{...}}` expressions
- Validates each expression by compiling with JEXL
- Catches syntax errors early

## Simplified Design

The system was simplified by **removing the `normalizeStepSyntax` function** which added unnecessary complexity:

**Before**: Users had to choose between two syntaxes:

- `{{ step "stepName" "property" }}` (confusing, non-standard)
- `{{ steps.stepName.property }}` (standard dot notation)

**After**: Only one clear syntax:

- `{{ steps.stepName.property }}` (standard dot notation)

This eliminates confusion and makes the API more intuitive.

## Why Both Mustache and JEXL?

The system uses **both** libraries because each solves a different hard problem:

1. **Mustache** solves the **parsing problem**: Finding expression boundaries in templates
2. **JEXL** solves the **evaluation problem**: Understanding and executing complex logic

### The Division of Labor

```
Template: "Status: {{status == 'active' ? 'Online' : 'Offline'}}"
           ↓
Mustache: "I found an expression between {{ and }}: status == 'active' ? 'Online' : 'Offline'"
           ↓
JEXL: "I can evaluate that! status is 'active', so the result is 'Online'"
           ↓
Result: "Status: Online"
```

### Mustache Strengths (Parsing)

- ✅ **Robust template parsing** - Handles complex template structures
- ✅ **Edge case handling** - Nested braces, quotes, escaping, special characters
- ✅ **Battle-tested** - Mature library used in production for years
- ✅ **Structured output** - Produces clean token stream for processing

**Example of what Mustache handles well:**

```typescript
// Complex template with nested braces and quotes
"User {{user.name}} said: \"{{message}}\" at {{time}}";

// Mustache correctly identifies 3 separate expressions:
// 1. user.name
// 2. message
// 3. time
```

### JEXL Strengths (Evaluation)

- ✅ **Powerful expression evaluation** - Comparisons, math, logic, ternary operators
- ✅ **Safe sandboxed execution** - No `eval()` or arbitrary code execution
- ✅ **Extensible** - Custom transforms for domain-specific operations
- ✅ **Type-aware** - Handles numbers, booleans, arrays, objects correctly

**Example of what JEXL handles well:**

```typescript
// Complex expression with logic and transforms
"items|filter('status', 'active')|map('price')|sum() > 1000";

// JEXL understands:
// - Chained transforms (filter → map → sum)
// - Comparison operators (>)
// - Array operations
// - Property access
```

---

## Why Not Just One Library?

### ❌ Option 1: JEXL Only (No Mustache)

**Problem**: JEXL doesn't have a template parser. You'd need to write one yourself.

**What you'd have to build:**

```typescript
// You'd need to write regex to find {{ }} boundaries
function parseTemplate(template: string) {
  // ❌ This is harder than it looks!
  const regex = /\{\{([^}]+)\}\}/g;

  // What about these edge cases?
  // "{{user.name}}"                    ✅ Works
  // "{{status == 'active' ? 'yes' : 'no'}}"  ❌ Breaks (quotes inside)
  // "{{items[0].name}}"                ✅ Works
  // "{{obj.nested.deep}}"              ✅ Works
  // "Price: ${{price * 1.1}}"          ✅ Works
  // "{{a}} and {{b}}"                  ✅ Works
  // "{{a ? '{{nested}}' : 'no'}}"      ❌ Breaks (nested braces)
  // "{{text|replace('}', ')')}}"       ❌ Breaks (} inside expression)
}
```

**Why this is hard:**

1. **Nested braces**: `{{a ? '{{nested}}' : 'no'}}` - Where does the expression end?
2. **Quotes**: `{{status == 'active' ? 'yes' : 'no'}}` - Don't split on `}}` inside quotes
3. **Escaping**: `{{text|replace('}', ')')}}` - Handle escaped characters
4. **Multiple expressions**: `{{a}} and {{b}}` - Track state between expressions

**Result**: You'd spend weeks building and debugging a template parser, duplicating Mustache's work.

---

### ❌ Option 2: Mustache Only (No JEXL)

**Problem**: Mustache is **logic-less** by design. It cannot evaluate expressions.

**What would happen:**

```typescript
// Simple variable - ✅ Works
replaceVariables('Hello {{name}}', { name: 'Alice' });
// Result: "Hello Alice"

// Comparison - ❌ Fails (renders as empty string)
replaceVariables('{{age > 18}}', { age: 25 });
// Result: "" (empty string, not "true")

// Ternary - ❌ Fails (renders as empty string)
replaceVariables("{{age >= 18 ? 'adult' : 'minor'}}", { age: 25 });
// Result: "" (empty string, not "adult")

// Math - ❌ Fails (renders as empty string)
replaceVariables('{{price * 1.1}}', { price: 100 });
// Result: "" (empty string, not "110")

// Transforms - ❌ Fails (no custom transforms)
replaceVariables('{{name|upper}}', { name: 'alice' });
// Result: "" (empty string, not "ALICE")

// Array operations - ❌ Fails
replaceVariables('{{items|length}}', { items: [1, 2, 3] });
// Result: "" (empty string, not "3")
```

**Why Mustache can't do this:**

Mustache is designed to be **logic-less**. It only supports:

- Simple variable substitution: `{{name}}`
- Sections (loops): `{{#items}}...{{/items}}`
- Conditionals (existence checks): `{{#exists}}...{{/exists}}`
- Partials (includes): `{{> partial}}`

It **does not** support:

- Operators: `>`, `<`, `==`, `+`, `-`, `*`, `/`
- Logic: `&&`, `||`, `!`
- Ternary: `? :`
- Custom functions/transforms
- Complex expressions

**Result**: Your workflow templates would be severely limited. No conditional logic, no calculations, no data transformations.

---

## The Solution: Mustache + JEXL

By combining both libraries, we get:

| Feature              | Mustache Only | JEXL Only              | **Mustache + JEXL** |
| -------------------- | ------------- | ---------------------- | ------------------- |
| Parse templates      | ✅            | ❌ (need custom)       | ✅                  |
| Handle edge cases    | ✅            | ❌ (need custom)       | ✅                  |
| Simple variables     | ✅            | ✅                     | ✅                  |
| Comparisons          | ❌            | ✅                     | ✅                  |
| Math operations      | ❌            | ✅                     | ✅                  |
| Ternary operators    | ❌            | ✅                     | ✅                  |
| Custom transforms    | ❌            | ✅                     | ✅                  |
| Safe execution       | ✅            | ✅                     | ✅                  |
| **Development time** | Fast          | Slow (build parser)    | **Fast**            |
| **Maintenance**      | Easy          | Hard (maintain parser) | **Easy**            |

### Real-World Example

**Workflow template:**

```typescript
'Customer {{customer.name}} ({{customer.email}}) ordered {{items|length}} items. ' +
  "Total: ${{items|map('price')|sum()|number}}. " +
  "Status: {{total > 100 ? 'VIP' : 'Standard'}}";
```

**How it's processed:**

1. **Mustache** parses and finds 6 expressions:
   - `customer.name`
   - `customer.email`
   - `items|length`
   - `items|map('price')|sum()|number`
   - `total > 100 ? 'VIP' : 'Standard'`

2. **JEXL** evaluates each expression:
   - `customer.name` → `"John Doe"`
   - `customer.email` → `"john@example.com"`
   - `items|length` → `3`
   - `items|map('price')|sum()|number` → `250.50`
   - `total > 100 ? 'VIP' : 'Standard'` → `"VIP"`

3. **Result:**
   ```
   "Customer John Doe (john@example.com) ordered 3 items. Total: $250.50. Status: VIP"
   ```

**Without Mustache**: You'd have to write a custom parser to extract those 6 expressions.

**Without JEXL**: The complex expressions would render as empty strings, making the template useless.

---

## Summary

**We need both because:**

1. **Mustache** is the best tool for **parsing templates** (finding `{{...}}` boundaries)
2. **JEXL** is the best tool for **evaluating expressions** (understanding complex logic)
3. Building a custom parser would take weeks and be error-prone
4. Using Mustache alone would severely limit template capabilities
5. Together, they provide a robust, powerful, and maintainable solution

**The key insight**: Don't solve problems that are already solved. Use the right tool for each job.

## Usage Examples

### Simple Variable Substitution

```typescript
replaceVariables('Hello {{name}}', { name: 'World' });
// Returns: "Hello World"
```

### Single Expression (Type Preserved)

```typescript
replaceVariables('{{user.age}}', { user: { age: 25 } });
// Returns: 25 (number, not string)
```

### Complex Expression

```typescript
replaceVariables("{{age >= 18 ? 'adult' : 'minor'}}", { age: 25 });
// Returns: "adult"
```

### Mixed Content

```typescript
replaceVariables('Product: {{product.name}}, Price: {{product.price|number}}', {
  product: { name: 'Widget', price: '99.99' },
});
// Returns: "Product: Widget, Price: 99.99"
```

### Nested Objects and Arrays

```typescript
replaceVariables("{{items|map('name')|join(', ')}}", {
  items: [{ name: 'A' }, { name: 'B' }],
});
// Returns: "A, B"
```

## Data Flow

```
Input: Template + Variables
    ↓
buildContext()
    ↓
Mustache.parse()
    ↓
For each token:
  - If text: append as-is
  - If expression: evaluateExpression() with JEXL
    ↓
Output: Rendered string
```

## How JEXL Processes the Token Stream

JEXL doesn't process the entire token stream at once. Instead, it processes **individual expression tokens** extracted by Mustache.

### Step-by-Step Example

**Input template:**

```
"Hello {{name}}, you have {{count}} items"
```

**Step 1: Mustache.parse() creates tokens:**

```typescript
[
  ['text', 'Hello '],
  ['name', 'name'],
  ['text', ', you have '],
  ['name', 'count'],
  ['text', ' items'],
];
```

**Step 2: Loop through tokens:**

For each token:

- **Token 1** `['text', 'Hello ']` → Type is 'text' → Append directly: `result = "Hello "`
- **Token 2** `['name', 'name']` → Type is 'name' → **Pass to JEXL**
  - Extract expression: `"name"`
  - JEXL evaluates: `evaluateExpression("name", context)` where `context = { name: "Alice", count: 5 }`
  - Result: `"Alice"`
  - Append: `result = "Hello Alice"`
- **Token 3** `['text', ', you have ']` → Type is 'text' → Append directly: `result = "Hello Alice, you have "`
- **Token 4** `['name', 'count']` → Type is 'name' → **Pass to JEXL**
  - Extract expression: `"count"`
  - JEXL evaluates: `evaluateExpression("count", context)`
  - Result: `5` (number)
  - Convert to string and append: `result = "Hello Alice, you have 5"`
- **Token 5** `['text', ' items']` → Type is 'text' → Append directly: `result = "Hello Alice, you have 5 items"`

**Final output:** `"Hello Alice, you have 5 items"`

### Complex Expression Example

**Input template:**

```
"Status: {{status == 'active' ? 'Online' : 'Offline'}}"
```

**Step 1: Mustache tokenizes (but can't evaluate):**

```typescript
[
  ['text', 'Status: '],
  ['name', "status == 'active' ? 'Online' : 'Offline'"], // Mustache extracts this but can't evaluate it
];
```

> **Important**: Mustache alone would render this as `"Status: "` (empty) because it doesn't understand the ternary operator. This is why we need JEXL!

**Step 2: Our code processes tokens:**

- **Token 1** `['text', 'Status: ']` → Append directly: `result = "Status: "`
- **Token 2** `['name', "status == 'active' ? 'Online' : 'Offline'"]` → **Pass to JEXL**
  - Mustache extracted the expression string
  - JEXL evaluates: `evaluateExpression("status == 'active' ? 'Online' : 'Offline'", { status: "active" })`
  - JEXL understands comparisons, ternary operators, etc.
  - Result: `"Online"`
  - Append: `result = "Status: Online"`

**Final output:** `"Status: Online"`

**Why this works:**

- ✅ Mustache: Robust parsing, finds the expression boundaries
- ✅ JEXL: Powerful evaluation, understands complex logic
- ✅ Together: Best of both worlds!

### Key Points

1. **Mustache's job**: Identify WHERE expressions are (between `{{` and `}}`)
2. **JEXL's job**: Evaluate WHAT the expressions mean
3. **Token types**:
   - `'text'`: Plain text → pass through unchanged
   - `'name'`: Variable/expression → evaluate with JEXL
   - `'&'`: Unescaped variable → evaluate with JEXL
   - Other types (sections, partials): Ignored

4. **JEXL receives**:
   - The expression string (e.g., `"name"`, `"count"`, `"status == 'active' ? 'Online' : 'Offline'"`)
   - The context object with all available variables
   - Returns the evaluated result

5. **Type handling**:
   - Strings: Appended as-is
   - Numbers/Booleans: Converted to string then appended
   - Objects/Arrays: JSON stringified then appended
   - null/undefined: Treated as empty string

## Error Handling

- **Unresolved templates**: Throws error if `{{...}}` markers remain after rendering
- **Invalid expressions**: JEXL throws error during compilation/evaluation
- **Type mismatches**: Gracefully converts to string or JSON

## Performance Considerations

- **Parsing**: Mustache.parse() is fast and cached by Mustache
- **Evaluation**: JEXL evaluation is synchronous and efficient
- **Context building**: Shallow merge of variables
- **Overall**: Suitable for workflow execution (not real-time rendering)

## Security

- **No arbitrary code execution**: JEXL is sandboxed
- **No eval() or Function()**: Safe expression evaluation
- **Controlled transforms**: Only whitelisted operations available
- **Input validation**: Template syntax validated before execution

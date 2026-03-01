---
description: WCAG 2.1 Level AA accessibility requirements
activationType: glob
patterns:
  - "**/components/**/*.tsx"
  - "**/app/**/*.tsx"
---

# Accessibility Standards (WCAG 2.1 Level AA)

## Semantic HTML
- ALWAYS CONSIDER semantic HTML elements
- Use: `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`
- Don't use: `<div>` with click handlers when `<button>` is appropriate

## Text Alternatives
- ALWAYS provide text alternatives for non-text content
- Use `alt` attributes for images
- Use `aria-label` for icon buttons
- Ensure decorative images have empty alt text (`alt=""`)

## Keyboard Accessibility
- ENSURE all interactive elements are keyboard accessible
- Provide visible focus states for all interactive elements
- Test navigation with Tab, Enter, Space, and Arrow keys
- Don't trap keyboard focus

## Heading Hierarchy
- USE proper heading hierarchy (`h1` → `h2` → `h3`)
- Never skip heading levels (don't go from `h1` to `h3`)
- Only one `h1` per page

## Forms
- ALWAYS associate form labels with inputs using `htmlFor` or wrapping
- PROVIDE clear error messages that identify the field and describe how to fix the issue
- Group related form elements with `<fieldset>` and `<legend>`

### ✅ Good - Accessible form
```tsx
<div>
  <label htmlFor="email">Email Address</label>
  <input 
    id="email" 
    type="email" 
    aria-describedby="email-error"
    aria-invalid={hasError}
  />
  {hasError && (
    <span id="email-error" role="alert">
      Please enter a valid email address
    </span>
  )}
</div>
```

## Color and Contrast
- AVOID using color alone to convey information
- Ensure sufficient color contrast ratios (4.5:1 for normal text, 3:1 for large text)
- Provide additional visual cues beyond color (icons, text, patterns)

## Dynamic Content
- USE `aria-live` regions for dynamic content updates
- Announce important changes to screen reader users
- Use appropriate `aria-live` politeness levels (polite, assertive)

### Example
```tsx
<div aria-live="polite" aria-atomic="true">
  {successMessage}
</div>
```

## Interactive Elements
- All clickable elements should be keyboard accessible
- Provide clear focus indicators
- Ensure touch targets are at least 44x44 pixels
- Use appropriate ARIA roles and attributes when needed

---
description: General coding standards and best practices for the Tale project
activationType: always_on
---

# General Coding Standards

## Performance & Design
- ALWAYS optimize your code for MAX performance
- ALWAYS ensure that you follow the existing design patterns
- ALL pages should be optimized for accessibility (WCAG Level AA)

## File Naming
- ALWAYS write filenames in dash-case (generally) and snake_case (for Convex and Python)
- Examples: `user-profile.tsx`, `data-table.tsx`, `get_products.py`

## Code Quality
- DO NOT write status comments like "REFACTORED:", "UPDATED:", "CHANGED:", "✅ REMOVED:", etc.
- DO NOT write inline comments explaining what was removed or changed
- Write clean, self-documenting code with clear function/variable names instead

## Translations & Localization
- ALWAYS use sentence case in translations
- DO NOT hardcode text in UI components - use translation hooks/functions instead
- DO NOT use `toLocaleDateString()`, `toLocaleTimeString()`, or `toLocaleString()`
- USE `useFormatDate()` hook (React) or `formatDate()` from `lib/utils/date/format` instead

## Data Safety
- NEVER delete, remove, or clear databases, caches, state files, or any persistent data without EXPLICIT user permission
- This includes local development databases (e.g., SQLite files, Convex local backend state), cache directories, and configuration state
- Always ask first before any destructive action

## Workspace Commands
- USE Bun workspaces for running scripts: `bun run --filter @tale/<workspace> <script>`
- Example: `bun run --filter @tale/platform lint`

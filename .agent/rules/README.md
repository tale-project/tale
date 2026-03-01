# Tale Workspace Rules

This directory contains workspace rules for Antigravity AI assistant. These rules ensure consistent code quality, style, and best practices across the Tale project.

## 📁 Rule Files

### Always Active
- **`general-coding-standards.md`** - Core standards that apply to all code

### Glob-Based (Auto-activated by file pattern)
- **`typescript-standards.md`** - TypeScript rules (`**/*.ts`, `**/*.tsx`)
- **`react-standards.md`** - React/TanStack rules (`**/*.tsx`, `**/app/**`, `**/components/**`)
- **`convex-standards.md`** - Convex backend rules (`**/convex/**/*.ts`)
- **`python-standards.md`** - Python service rules (`**/*.py`)
- **`accessibility-standards.md`** - WCAG 2.1 AA standards (`**/components/**/*.tsx`, `**/app/**/*.tsx`)

### Model Decision (AI decides when to apply)
- **`testing-standards.md`** - Testing requirements (applied when creating/modifying features)

### Manual Activation (Use @mention)
- **`git-standards.md`** - Git commit standards (mention when working with commits)

## 🎯 How Rules Are Activated

| Activation Type | When Applied | Example |
|----------------|--------------|---------|
| **Always On** | Every interaction | General coding standards |
| **Glob** | When working with matching files | TypeScript rules for `.ts` files |
| **Model Decision** | AI determines relevance | Testing rules when adding features |
| **Manual** | You @mention the rule | Git rules when committing |

## 🔧 Usage Examples

### Automatic Activation
```
# Working on a React component
# → general-coding-standards.md (always on)
# → typescript-standards.md (*.tsx)
# → react-standards.md (components/**)
# → accessibility-standards.md (components/**)
```

### Manual Activation
```
"@git-standards help me write a good commit message"
```

## 📝 Rule Format

Each rule file uses YAML frontmatter:

```markdown
---
description: Brief description of the rule
activationType: always_on | glob | model_decision | manual
patterns:  # Only for glob type
  - "**/*.ts"
  - "**/*.tsx"
modelDecision: "Description for AI" # Only for model_decision type
---

# Rule Content
...
```

## 🔄 Syncing with .claude/CLAUDE.md

These rules are derived from `.claude/CLAUDE.md`. If you update the Claude rules, consider updating these workspace rules as well to keep them in sync.

## 🚀 Benefits

- ✅ **Consistent code quality** across the entire project
- ✅ **Context-aware guidance** based on file types
- ✅ **Automatic enforcement** of best practices
- ✅ **Clear documentation** of project standards
- ✅ **Easier onboarding** for new team members

## 📚 Related Documentation

- `.claude/CLAUDE.md` - Original Claude rules
- `docs/` - Project documentation
- `.agent/workflows/` - Automated workflows

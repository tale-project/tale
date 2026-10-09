---
title: Code editor
description: Edit code, JSON, YAML and templates with highlighting, completion and inline problems, and leave the field with the keyboard.
---

`CodeEditor` is the field for anything a reader writes as code: a transform's script, a condition, a connector's JSON input, a prompt with `{{ }}` templates, an automation in YAML. It highlights in the same colours as read-only code blocks, takes completion, hover and problems from your host, and never traps a keyboard user.

```tsx
import { CodeEditor, preloadCodeEditor } from '@tale/ui/code-editor';
import { combineProviders } from '@tale/ui/code-editor/providers';
import { scanTemplates } from '@tale/ui/code-editor/template-scan';
import { locateJsonPointer, locateYamlPointer } from '@tale/ui/code-editor/locate';
```

## Edit code in a form

<Demo name="code-editor/basic" />

Put the editor in a `Field` and pass the field's `htmlFor` as the editor's `id`. The editor's text is not an `input`, so the field names it with `aria-labelledby`, and a click on the label still moves focus into it. `value` and `onChange` work as in any controlled field. The editor applies a new `value` as the smallest change, so a host that rewrites the text on every keystroke never moves the caret, and it never echoes a `value` you passed back to `onChange`.

The implementation (CodeMirror 6) loads the first time an editor mounts. Until it arrives, the field shows its text in the editor's own metrics, so nothing moves when the editor replaces it, and a focus request made meanwhile waits for it. Call `preloadCodeEditor()` when a surface that is likely to show code mounts, or on hover over what opens it.

`minRows` and `maxRows` set the height: the field grows with its text, then scrolls. `fillHeight` fills a flex parent instead. `lineNumbers` adds the gutter, with fold markers unless you pass `fold={false}`. `expandable` adds **Expand editor**, which opens the same field in a large dialog and carries the caret there and back.

## Choose a language

<Demo name="code-editor/languages" />

| `language` | Use it for |
| --- | --- |
| `javascript` | A script: statements and a top-level `return`, such as a transform's body. |
| `expression` | One expression, such as a condition. `{ a: 1 }` reads as an object. |
| `json`, `yaml` | Structured values. With `templates`, the `{{ }}` inside string values are parsed as JavaScript. Keys never hold templates. |
| `markdown` | Prompts and descriptions, highlighted only. |
| `template` | Text with `{{ }}` templates. |
| `text` | Plain text. `templates` turns templates on. |

`font="prose"` sets the text in the reading font, for prompts; templates keep the code font. `singleLine` makes a one-line field: Enter submits instead of adding a line, Tab moves focus, and a pasted line break becomes a space.

## Write templates

<Demo name="code-editor/templates" />

Each `{{ … }}` reads as one tinted chip, and the JavaScript inside it is highlighted and completed like code. Typing `{` after `{` gives `{{  }}` with the caret inside and opens completion. Typing `}` in front of the closing braces steps over them, and Backspace in an empty `{{ }}` removes the pair. A `{{` with no closing `}}` is marked as a problem.

A template ends at the `}}` that closes its expression, not at the first `}}`, so `{{ xs.map(x => ({ y: x })) }}` and `{{ "}}" }}` are one template each. The editor's own rule is that every bracket and string inside has closed. If your runtime decides differently, pass its rule as `templateScanner` so the editor and the runtime agree exactly. `scanTemplates` from `@tale/ui/code-editor/template-scan` is the default.

## Show problems

<Demo name="code-editor/diagnostics" />

Pass `diagnostics`, each with an `id`, a `severity` (`error`, `warning` or `info`), a translated `message`, and usually a `range` into the text. Without a range the whole field is meant. `code` shows small in the tooltip, `detail` takes any node (an `IssueDetail`, for example), and `fixes` offer one-click repairs.

A check takes time, and the reader keeps typing. Pass the text you checked as `diagnosticsFor`: the editor maps each range onto the current text and hides a problem whose text was edited until your next result. While a check runs, set `diagnosticsStatus="checking"`: the underlines fade to 60 % and the text is marked busy.

| Severity | Underline | Gutter |
| --- | --- | --- |
| `error` | Wavy, 1.5 px | Crossed circle |
| `warning` | Wavy, 1 px | Triangle |
| `info` | Dotted, 1 px | Circled i |

The editor adds marks of its own: JSON or YAML that does not parse, JavaScript it cannot read, and an unclosed `{{`. They wait half a second after the last edit, never sit under the word being typed, and give way to any problem you report at the same place. `syntaxDiagnostics={false}` turns them off. A `lint` provider adds instant local problems of yours.

Hover a problem to see its tooltip. F8 and Shift+F8 move to the next and previous problem, select it, open its tooltip and read it aloud. ⌘. (Ctrl+. elsewhere) applies a fix, or moves focus to the fix buttons when there are several; the arrow keys move between them. The editor describes its problems to assistive technology with a summary; inside a `Field` that already lists them, pass `describeDiagnostics={false}`. The editor never announces a new result by itself: announce a check's result once, with [`IssueAnnouncer`](/docs/components/issue-list#count-and-announce-the-result).

## Complete names and show types

<Demo name="code-editor/completion" />

`providers.completion` receives where the cursor is: the `region` (code, the code inside a template, text, or a JSON or YAML key or value), the member `path` before the word being typed (`nodes["a b"]?.x.` gives `['nodes', 'a b', 'x']`), the `prefix`, and for JSON and YAML the `pointer` of the object a key belongs to or of the value. Return items with a `label`, and optionally a `detail`, a `kind` and `valueType` for the icon, a `section`, and `info` for the side panel. A name that is not an identifier goes in as `["a b"]`, an index as `[0]`.

The list opens as the reader types a name, a `.` or a `[` in code, or a key in JSON or YAML, and Ctrl+Space opens it anywhere. Enter or Tab accepts. A provider may answer asynchronously: its `signal` aborts when the reader types on, and equally good matches keep your order.

`providers.hover` answers for the name under the pointer after 200 ms, and for the name at the cursor on ⌘K ⌘I (Ctrl+K Ctrl+I), which also reads the type aloud. `combineProviders` merges several hosts, such as known data shapes and a type checker.

## Keyboard

| Key | Several lines | One line |
| --- | --- | --- |
| Tab, Shift+Tab | Indent, outdent | Next, previous control |
| Esc | Closes the list, a tooltip or search; with nothing open, arms leaving for two seconds | The same |
| Esc, then Tab | Leaves the editor | — |
| Ctrl+M (Shift+Alt+M on a Mac) | Makes Tab move focus from now on, or indent again | — |
| Enter | New line | `onSubmit` |
| ⌘Enter (Ctrl+Enter) | `onSubmit` | `onSubmit` |
| Ctrl+Space | Completion | Completion |
| F8, Shift+F8 | Next, previous problem | The same |
| ⌘. (Ctrl+.) | Apply a fix | The same |
| ⌘K ⌘I (Ctrl+K Ctrl+I) | Show the type | The same |
| ⌘F (Ctrl+F) | Find and replace, with `search` | — |

After keyboard focus, a small legend on the field's bottom edge shows the way out, and the submit shortcut when you pass `onSubmit` and `submitLabel`. The same words describe the field to assistive technology. A pointer never shows the legend.

Escape is claimed while the editor needs it, so the first Escape in a sheet closes the completion list and the next arms leaving; the sheet closes on the third. See [widgets that use Escape](/docs/components/dialog#widgets-that-use-escape).

## Read-only code

<Demo name="code-editor/read-only" />

Use `readOnly` when read-only text needs the editor: problems on it, or a go-to that selects a range. It is focusable and selectable, says it is read-only, and takes the code-block surface. To only display code, use `CodeBlock` from `@tale/ui/markdown/code-block`. It highlights with the same palette, including templates in `json-template`, `yaml-template`, `markdown-template` and `tale-template`, without loading the editor.

## Take the reader to a range

Inside an `IssueFocusProvider`, give the editor an `issueAnchor`. A go-to request for that anchor selects its range in the text, even when it arrives before the editor has loaded. A request for a part below the anchor, such as `/nodes/0/input/to` for an editor at `/nodes/0/input`, finds that key in JSON or YAML text. `locateJsonPointer` and `locateYamlPointer` do the same for your own use, with escapes and block scalars mapped onto the raw text. Pass `issueReveal` when the editor sits behind a tab or a collapsed section. See [field issues](/docs/components/field-issues) for the registry.

## Props

| Prop | Default | Purpose |
| --- | --- | --- |
| `value`, `onChange` | — | The text, controlled. |
| `language` | — | See [Choose a language](#choose-a-language). |
| `templates` | `false` | `{{ }}` in JSON, YAML, Markdown or text. |
| `templateScanner` | `scanTemplates` | Your runtime's rule for where a template ends. |
| `readOnly`, `disabled`, `disabledReason` | `false` | As on `Textarea`: with a reason, a disabled editor stays focusable and shows it. |
| `placeholder` | — | Shown while the text is empty. |
| `singleLine` | `false` | One line: Enter submits, Tab leaves. |
| `minRows`, `maxRows` | 3 and 14; 1 and 4 in one line | The height range. |
| `fillHeight` | `false` | Fill a flex parent. |
| `wrap` | On for prose, templates, text and one line | Soft-wrap long lines. |
| `font` | `mono` | `prose` for prompts. |
| `size` | `sm` | `sm` is 12 px, `md` 14 px; 16 px on small screens, so phones never zoom. |
| `lineNumbers`, `fold`, `search` | `false` | Gutter, fold markers, find and replace. |
| `expandable` | `false` | **Expand editor**; `{ title }` names the dialog. |
| `diagnostics`, `diagnosticsFor`, `diagnosticsStatus` | — | Problems, the text they were found in, and whether a check runs. |
| `describeDiagnostics`, `syntaxDiagnostics` | `true` | The problem summary, and the editor's own marks. |
| `providers` | — | Completion, hover and lint. |
| `onSubmit`, `submitLabel` | — | ⌘Enter, and the button label the shortcut hint names. |
| `issueAnchor`, `issueReveal` | — | Go-to from a problems list. |
| `initialSelection` | — | Where the caret starts. |
| `id`, `aria-*`, `required` | — | Set on the editable text; a `Field` sets most of them. |

The ref (`CodeEditorHandle`) has `focus(range?)`, `getSelection()`, `openCompletion()` and `nextDiagnostic(direction)`.

## Accessibility

The text is a labelled text box with a "code editor" role description, and the editor's own words (the completion list's name, the search panel, announcements) come in the reader's language. Problems never rely on colour: the underline style and the gutter glyph say the severity, and the words are in the tooltip and the summary. The colours clear 4.5:1 on every code surface in both themes, and the underlines 3:1. In a Windows contrast theme the selection and underlines take the system colours. Under reduced motion the list and tooltips appear without animation and the caret stops blinking. Below the `md` breakpoint the text is 16 px, so iOS does not zoom, and in a sheet, selecting text never drags the sheet.

# Source conventions

Use the nearest docs contract for exact fields, paths, and commands. These practices keep the
content readable in the site, search results, source, and localized editions.

## Frontmatter and paths

Supply a sentence-case `title` and a specific `description` that helps readers choose the page in
search. Do not repeat “This page covers” in descriptions. Preserve supported metadata and any
reasoned opt-outs. Regenerate derived search/frontmatter data when required by the repository.

Use lowercase dash-case filenames. Before moving a published page, inspect navigation and inbound
links, add a redirect, and update every full locale. Do not rename slugs merely to translate a title.

## Headings and links

The site renders the frontmatter title as H1; start body sections at H2 and keep a logical hierarchy
within the repository's H4 limit. Use action headings for procedures, symptom headings for
troubleshooting, and precise noun headings for reference. A useful “Next steps” section is allowed;
its value comes from its destinations, not an elaborate heading.

Use descriptive link text and link at the moment the reader needs the destination. Internal links
in localized docs need that locale's prefix. Verify translated heading anchors in the rendered
page. Keep external URLs fully qualified. Check links from READMEs and app help as well as docs.

## Examples

Fence code with a language identifier and any supported filename/tool label. Explain the purpose,
prerequisites, values the reader must replace, and result when those are not clear from context.
Show full runnable examples or label intentional fragments. Do not present ellipses as executable
syntax. Use the observed output; label shortened or normalized output and preserve its meaning.

Keep executable syntax, identifiers, routes, flags, and JSON keys identical across locale mirrors
unless an example explicitly requires a localized input. Translate explanatory code comments and
surrounding prose while preserving their meaning and any literal tokens they name. Never translate
an enum or turn a decimal point into a comma inside JSON.

## Lists and tables

Use bullets for parallel options or checks, and numbering where order matters. A list of two useful
choices is valid. Keep entries grammatically parallel. Prefer a table when readers compare the
same attributes across entries; introduce unfamiliar context, but do not add a filler sentence
before a self-explanatory table. Keep cells concise and check narrow-screen readability.

## Typography and UI labels

Use sentence case according to the language's grammar. Format visible UI labels in bold and match
the shipped catalog exactly. Use inline code for technical identifiers, file paths, and literal
values. Apply locale prose typography outside these exact tokens, following write-translations.

## Scope boundaries

Separate product operation from deployment configuration where audiences differ. Link the
canonical environment, permission, API, or error reference rather than copying facts that will
drift. Keep legal and contractual meaning intact; stylistic cleanup does not authorize changing
policy. Preserve user-excluded media or topics.

# English (en) terminology

English is the source locale. All other locale files derive from `en.json`.

| Term                           | Preferred form                   | Notes                                  |
| ------------------------------ | -------------------------------- | -------------------------------------- |
| AI                             | AI                               | Not "A.I." or "Artificial Intelligence"|
| Agent                          | Agent                            | Capitalized when referring to a Tale agent |
| Workflow                       | Workflow                         | One word, not "work flow"              |
| Dashboard                      | Dashboard                        | One word                               |
| Webhook                        | Webhook                          | One word                               |
| API / LLM / Token / Prompt     | Keep as-is                       | Universal tech terms, no expansion     |
| Provider                       | Provider                         | For LLM/email providers                |
| Settings                       | Settings                         | Not "Preferences" or "Options"         |
| Knowledge                      | Knowledge                        | For the knowledge base feature         |
| Automation(s)                  | Automation(s)                    | Not "Workflow" (distinct features)     |
| Integration(s)                 | Integration(s)                   |                                        |
| Log in / Log out               | Log in / Log out                 | Two words as verb, "Login" as noun/adj |
| Sign up                        | Sign up                          | Two words as verb, "Signup" as noun/adj|
| E-mail                         | E-mail                           | With hyphen                            |
| Upload / Download              | Upload / Download                |                                        |
| PII                            | PII                              | Personally identifiable information    |

## Style rules

- USE sentence case in all UI strings (e.g., "Save changes", not "Save Changes").
- USE informal, direct tone — address the user as "you" (not "the user" or passive voice).
- PREFER short, scannable labels for buttons and menu items (1-3 words).
- USE the Oxford comma in lists.
- USE "e.g." and "i.e." in tooltips/descriptions, not "for example" or "that is" (saves space).
- WRITE error messages that tell the user what happened and what to do next.
- AVOID jargon in user-facing strings — prefer plain language over technical terms where possible.
- USE ICU `one`/`other` for plurals (e.g., `{count, plural, one {# item} other {# items}}`).

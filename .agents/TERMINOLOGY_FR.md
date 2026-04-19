# French (fr) terminology

See [`TERMINOLOGY.md`](TERMINOLOGY.md) for cross-locale rules. The Swiss variant has its own delta file:

- Switzerland: [`TERMINOLOGY_FR_CH.md`](TERMINOLOGY_FR_CH.md)

## Preferred forms

| English                        | French                             | Notes                                                  |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| AI                             | IA                                 | Intelligence artificielle                              |
| Agent                          | Agent                              | Same in French                                         |
| Workflow / Dashboard / Webhook | Keep English                       | Established loanwords                                  |
| API / LLM / Token / Prompt     | Keep English                       | Universal tech terms                                   |
| Provider                       | Fournisseur                        |                                                        |
| Settings                       | Paramètres                         |                                                        |
| Knowledge                      | Connaissances                      |                                                        |
| Knowledge base                 | Base de connaissances              |                                                        |
| Workspace                      | Espace de travail                  |                                                        |
| Automation(s)                  | Automatisation(s)                  |                                                        |
| Team                           | Équipe                             | Singular form is "équipe" (note the accent)            |
| Branding                       | Keep English                       | Loanword                                               |
| Integration(s)                 | Intégration(s)                     | Same root                                              |
| Save / Delete / Edit           | Enregistrer / Supprimer / Modifier |                                                        |
| Log in                         | Se connecter                       |                                                        |
| Log out                        | Se déconnecter                     |                                                        |
| Sign up                        | S'inscrire                         |                                                        |
| Upload                         | Téléverser                         | Verb; noun: "téléversement"                            |
| Download                       | Télécharger                        |                                                        |
| PII                            | DCP                                | Données à caractère personnel                          |
| E-mail                         | E-mail                             | With hyphen (Académie française)                       |
| User                           | Utilisateur/trice                  | Or "utilisateur" in mixed/generic use                  |
| Browser                        | Navigateur                         |                                                        |
| Self-hosted                    | Auto-hébergé                       | Hyphenated                                             |
| On-premises                    | Sur site                           | Alternative loanword: "on-premises"                    |
| Open source                    | Open source                        | Loanword; invariable                                   |
| Canvas                         | Canvas                             | Keep English (product feature name)                    |
| Prompt / Prompt Library        | Prompt / Prompt Library            | Keep English (product feature names)                   |
| Zero-downtime                  | Zero-downtime                      | Keep English                                           |
| Blue-green                     | Blue-green                         | Keep English                                           |

## Role names

Tale's roles stay in English as loanwords (matches the UI): **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**. In role references, capitalise them.

When "member" is used generically (not as the Member role), translate to **membre(s)** — never leave it as "member" or "members" in French prose. Example: "Les membres de ton équipe utilisent le chat" vs. "Un Member peut consulter l'historique du chat".

## Style rules (French-specific)

- USE the informal "tu" form consistently — never "vous" for addressing the user.
- USE « guillemets français » in running prose. Straight `"..."` inside UI labels and code blocks.
- USE a **non-breaking space** before `:`, `;`, `!`, `?`, and `%`, and inside guillemets (`« texte »`). In markdown that's typically a regular space — rendering normalises it — but preserve the exact character when copying from an authoritative source.
- USE comma as decimal separator in docs prose (`2,5 Go`). Inside code blocks and env-var values, keep the period (`2.5`).
- USE narrow non-breaking space as thousands separator (`1 000`).
- DATES in docs prose: `DD/MM/YYYY` (e.g. `19/04/2026`). In frontmatter and technical context, use ISO (`2026-04-19`).
- USE 24-hour clock (`09 h 00`, `17 h 30`) in user-facing copy; cron and logs keep their canonical formats.
- CAPITALISE only the first word of a heading and proper nouns (sentence case): `## Concepts des agents`, not `## Concepts des Agents`.
- AVOID English gerunds dropped into prose untranslated. "Le monitoring" → "La supervision" where the sense is Tale's built-in Prometheus story; keep "monitoring" if it's a well-established tool-name loanword.
- USE inclusive gender forms sparingly — prefer neutral nouns ("l'équipe", "les personnes") over the "utilisateur·rice" form in long-form docs. In space-tight UI, `utilisateur` alone is acceptable.
- CONFIRM UI labels against `messages/fr.json` before quoting them in docs. A doc that tells the user to click "Enregistrer" must match the actual French button label.

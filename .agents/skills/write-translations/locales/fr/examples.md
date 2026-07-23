# FR — examples

## Positive — a correct translation that doesn't translate one thing

**English source.** _Open a pull request from your feature branch. The CI pipeline runs against the head of the branch; the merge into `main` is gated on green._

**French target.** _Ouvre une Pull Request depuis ton feature branch. Le pipeline CI s'exécute contre la tête du branch ; le merge dans `main` reste bloqué tant que le pipeline n'est pas vert._

**Why this works.** `Pull Request`, `feature branch`, `pipeline`, `CI`, `merge`, `branch` stay English (Git-domain + bucket-2 loanwords). `tu` form (`ton`, `Ouvre`). NBSP before `;`. `s'exécute` uses typographic apostrophe. No `Vous`, no `Découvrez`, no `N'hésite pas à`.

## Positive — concept page opening

**English source.** _An agent is a bundle of four things: instructions, knowledge, tools, and a model._

**French target.** _Un agent est un ensemble de quatre éléments : des instructions, une base de connaissances, des tools et un modèle._

**Why this works.** `agent`, `tools`, `modèle` — `tools` stays English (bucket 2), `modèle` translates. `base de connaissances` (translate-bucket compound, whole translation). NBSP before `:`. `tu`-implicit (no `vous`).

## Positive — UI walkthrough, effect-first

**English source.** _To restrict an agent's knowledge to one folder, open the agent's **Knowledge** tab and pick the folder under **Sources**._

**French target.** _Pour restreindre les connaissances d'un agent à un dossier, ouvre l'onglet **Base de connaissances** de l'agent et choisis le dossier sous **Sources**._

**Why this works.** Effect-first phrasing. UI labels (`Base de connaissances`, `Sources`) match what the shipped UI displays in French — pulled from `services/platform/messages/fr.yml`. `tu` form (`ouvre`, `choisis`). `l’onglet`, `d’un`, `l’agent` — typographic apostrophes.

## Drift → target #1 — marketing softener

**Drift.** _Découvrez notre puissante fonctionnalité de Knowledge Base, simplement clé en main._

**Target.** _Ouvre la **Base de connaissances**. Elle indexe automatiquement les documents que tu charges et les rend disponibles aux agents en 30 secondes._

**Why.** The drift stacks four softeners (`Découvrez`, `puissante`, `simplement`, `clé en main`) onto a half-compound (`Knowledge Base`). The target uses the imperative, names the concrete behaviour (30-second indexing), and uses the shipped UI label.

## Drift → target #2 — `vous`-slip

**Drift.** _Vous pouvez configurer le webhook depuis votre tableau de bord._

**Target.** _Configure le webhook depuis ton tableau de bord._

**Why.** Imperative replaces the modal verb construction; `tu` form (`ton`) replaces formal `votre`. Shorter and direct.

## Drift → target #3 — nominal stacking

**Drift.** _Une solution clé en main pour la gestion documentaire intégrée multilingue._

**Target.** _Une solution qui gère les documents dans plusieurs langues._

**Why.** The drift stacks five nominal phrases (`solution` + `gestion` + `documentaire` + `intégrée` + `multilingue`). The target uses a relative clause that reads native. `clé en main` is also a marketing softener; gone.

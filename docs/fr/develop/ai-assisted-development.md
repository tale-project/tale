---
title: Développement assisté par IA
description: Comment Claude Code, Cursor, Copilot et Windsurf éditent un projet Tale — le fichier de règles que chaque éditeur lit et le miroir de schéma que Tale génère sous `.tale/reference/`.
---

Les projets Tale sont du JSON — agents, workflows, connectors, branding — et le JSON s'édite bien dans les éditeurs IA quand l'éditeur connaît le schéma. La CLI pose deux choses pour cela : un fichier de règles que chaque éditeur lit à la racine du projet (`CLAUDE.md` pour Claude Code, `.cursor/rules/tale.mdc` pour Cursor, `.github/copilot-instructions.md` pour Copilot, `.windsurfrules` pour Windsurf), et un miroir de schéma en lecture seule sous `.tale/reference/` vers lequel le fichier de règles pointe l'éditeur.

Lis ceci quand tu veux éditer un projet Tale dans un éditeur IA sans taper le JSON à la main. Reviens-y quand l'éditeur invente des champs ou câble la mauvaise forme d'agent — la réponse est presque toujours que le schéma sous `.tale/reference/` est périmé.

## Une mise en place mise en pratique

Initialise un projet — la CLI écrit le fichier de règles et le miroir de schéma dans la même étape :

```bash
tale init my-org
cd my-org
ls -a
# .cursor/  .github/  .tale/  .windsurfrules
# CLAUDE.md  agents/  workflows/  connectors/  branding/
```

`CLAUDE.md` (installé en même temps comme `.mdc` Cursor, `.md` Copilot et fichier de règles Windsurf) dit à l'éditeur où regarder avant d'éditer une config :

> Before creating or editing any config, read the relevant schemas and implementation code in `.tale/reference/` to understand the valid structure, fields, and constraints. Use existing config files in the project as examples.

La directive compte parce que tout éditeur sous charge saute les lectures de schéma sauf instruction contraire. Le fichier de règles est le contrat ; le miroir de schéma est la vérité du terrain.

## Ce qui vit où

| Chemin                           | Ce que c'est                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `agents/`                        | Un fichier JSON par agent — instructions, connaissances, tools, modèle.             |
| `workflows/`                     | Configs JSON de workflow, groupées par sous-répertoire de catégorie.                |
| `connectors/<slug>/config.json`  | Manifeste de connector — operations, méthode d'auth, hôtes autorisés.               |
| `connectors/<slug>/connector.ts` | Connector TypeScript optionnel pour les formes REST que le manifeste ne couvre pas. |
| `branding/branding.json`         | Branding de l'org — couleurs, logos, expéditeurs courriel.                          |
| `.tale/reference/`               | Miroir de schéma en lecture seule ; régénéré par `tale init` et `tale update`.      |

L'arbre de référence est byte-à-byte identique aux schémas contre lesquels la plateforme valide au déploiement. Traite-le comme canonique : quand un nom de champ dans une config écrite à la main désaccorde avec la référence, la référence gagne.

## Travailler avec l'éditeur

Le fichier de règles nomme trois règles que chaque éditeur applique pendant l'édition :

- **Les agents lient, délèguent, attachent.** Un agent peut simultanément lier des connectors (`connectorBindings`), déléguer à d'autres agents (`delegates`) et attacher des workflows (`workflows`). Lis les configs existantes avant d'introduire une nouvelle liaison.
- **Les workflows utilisent les operations de connector.** Une étape de workflow référence une operation de connector déclarée dans `connectors/<slug>/config.json`. Éditer une étape contre une operation qui n'existe pas fait échouer la validation.
- **Le nommage est imposé.** Les noms de fichier d'agent correspondent à `[a-z0-9][a-z0-9_-]*\.json`. Les slugs d'étape de workflow correspondent à `[a-z0-9][a-z0-9_-]*`. Les répertoires de connector sont en minuscules alphanumériques avec tirets ou soulignés.

Quand l'éditeur propose un changement, demande-lui de citer le fichier dans `.tale/reference/` sur lequel il s'est appuyé. S'il ne peut pas, régénère le miroir avec `tale update` et réessaie.

## Cursor : plan config vs plan runtime

Cursor apparaît dans Tale à deux endroits distincts — ne les confonds pas.

| Plan        | Rôle                                                                                                                           | Où ça vit                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Config**  | Aide Cursor (ou tout éditeur IA) à éditer le JSON d'un projet Tale sur ta machine                                              | `.cursor/rules/tale.mdc`, `CLAUDE.md`, `.tale/reference/` — tout ce que `tale init` écrit                       |
| **Runtime** | Lance la CLI Cursor Agent en mode headless dans un bac à sable isolé quand tu discutes avec l'agent externe **Cursor** intégré | Sélecteur de chat → **Cursor** ; JSON d'agent avec `primaryBehavior: "external-agent"` et `agentKind: "cursor"` |

Le fichier de règles et le miroir de schéma sur cette page sont le **plan config** : ils guident un éditeur local pendant que tu modifies agents, workflows et connectors. Le **plan runtime**, c'est un tour de bac à sable géré — `agent -p --output-format stream-json` avec ta `CURSOR_API_KEY`, progression normalisée dans le chat et reprise de session entre les relances. Credentials, modèles et facturation des tours runtime sont dans [External agents](/fr/platform/agents/external-agent), pas ici.

## Où cela s'inscrit

Le développement assisté par IA est le chemin d'édition ; le déploiement est le chemin de publication. Une fois qu'une config passe la validation de l'éditeur, [`tale deploy`](/fr/self-hosted/install/cli-install) la rapproche de la plateforme — le même contrôle de schéma, cette fois comme barrière. Pour les fonctionnalités que l'éditeur n'atteint pas (le constructeur dans le produit, l'éditeur visuel de workflow), l'[onglet Platform](/fr/platform) est la surface canonique ; le chemin éditeur IA ici est pour les projets qui préfèrent la config-as-code.

---
title: Développement assisté par IA
description: Comment un agent de code édite un projet Tale — les fichiers AGENTS.md et CLAUDE.md que la CLI écrit, le miroir des sources sous .tale/reference/, et la disposition par organisation des fichiers de configuration.
---

Un projet Tale est un répertoire de fichiers de configuration en clair — agents, skills, branding, fournisseurs, connectors — rangés par organisation, et cette disposition s’édite bien avec un agent de code dès qu’il connaît les règles. La CLI écrit ces règles pour toi : un `AGENTS.md` à la racine du projet avec toute la consigne, un `CLAUDE.md` qui pointe vers lui, et un miroir en lecture seule des sources de la plateforme sous `.tale/reference/` que les deux fichiers demandent à l’agent de lire avant de toucher une config.

Lis ceci quand tu veux modifier un projet Tale avec Claude Code ou tout autre agent qui lit `AGENTS.md`, sans taper la configuration à la main. Reviens-y quand l’agent invente des champs — le remède est presque toujours de lui faire relire `.tale/reference/`, ou de rafraîchir le miroir avec `tale update`.

## Une mise en place concrète

`tale init` pose le projet, les fichiers de consigne et le miroir en une seule étape. Voici tout l’arbre qu’il laisse derrière lui :

```bash
tale init my-org --no-env
cd my-org
ls -a
```

```text
AGENTS.md  CLAUDE.md  default  .gitignore  .tale  tale.json
```

`--no-env` ne fait que sauter la question sur le `.env` pour ce parcours. Le résumé que la commande affiche nomme ce qu’elle a semé — un agent dans le catalogue, cinq bundles de skills, un fichier de branding — et les étapes suivantes : `tale dev` pour lancer l’instance en local, `tale deploy` quand tu es prêt à publier.

## Les deux fichiers de consigne

`AGENTS.md` porte la consigne : la disposition par organisation, les règles de nommage des slugs et des fichiers, la politique des secrets, et une directive qui fait l’essentiel du travail :

> Before creating or editing any config, read the relevant schemas and implementation code in `.tale/reference/` to understand the valid structure, fields, and constraints. Use existing config files in the project as examples.

`CLAUDE.md` existe parce que Claude Code lit `CLAUDE.md` et non `AGENTS.md` ; il ne contient qu’un renvoi vers `AGENTS.md`, pour qu’il n’y ait qu’une seule source de vérité. Les deux fichiers sont écrits dans un bloc géré — de `<!-- tale:begin -->` à `<!-- tale:end -->` — et tout ce que tu ajoutes hors des marqueurs survit à chaque `tale init --force` et à chaque `tale update`. La CLI n’écrit aucun fichier de règles propre à un éditeur : pas de `.cursor/rules`, pas de `.windsurfrules`, pas d’instructions Copilot. Un agent qui suit la convention `AGENTS.md` lit le fichier de lui-même ; un autre, tu le pointes dessus à la main.

## Ce qui vit où

La configuration et le miroir se côtoient sous la racine du projet. Tout ce qui est sous `default/` est à toi — à éditer et à committer ; tout ce qui est sous `.tale/` est généré et ignoré par git.

| Chemin                                                            | Ce que c’est                                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default/agents/`                                                 | Un fichier YAML par persona d’agent ; `coding-agent.yml` est livré.                                                                                                                 |
| `default/skills/`                                                 | Un répertoire par bundle de skill ; `docx`, `pdf`, `pptx`, `xlsx` et `visual-aspect-analyzer` sont livrés.                                                                          |
| `default/branding/`                                               | `branding.json` et un dossier `images/` pour les ressources téléversées.                                                                                                            |
| `default/automations/`                                            | Un fichier par automatisation — les 25 automatisations intégrées sont livrées comme catalogue à partir duquel tu déploies.                                                          |
| `default/governance/`                                             | Les politiques de gouvernance de l’organisation, une `<policyType>.json` chacune, plus le catalogue de bornes `retention.json` ; les sidecars chiffrés `*.secrets.json` ne sont jamais créés. |
| `default/README.md`                                               | Explique l’arbre ; géré comme les autres fichiers d’échafaudage.                                                                                                                    |
| `.tale/reference/`                                                | Sources de la plateforme en lecture seule — `backend/` et `lib/`, y compris les schémas partagés contre lesquels une config est validée. Régénéré par `tale init` et `tale update`. |
| `.tale/orgs/<slug>/<domain>/`                                     | Configuration d’exécution des organisations créées dans l’app ; `tale deploy --override` la pousse.                                                                                 |
| `.tale/checksums.json`                                            | Le hash de chaque fichier d’échafaudage, pour que `tale update` distingue tes modifications des siennes.                                                                            |

`default` est le modèle dont chaque nouvelle organisation est semée — jamais une organisation déployable en soi. Les vraies organisations se créent dans l’app et vivent sous `.tale/orgs/`.

## Garder le miroir à jour

`tale update` porte la CLI à la dernière version de sa ligne et resynchronise les fichiers du projet : il réécrit les blocs gérés d’`AGENTS.md` et de `CLAUDE.md`, régénère `.tale/reference/`, ajoute les fichiers d’échafaudage nouveaux, écrase ceux que tu n’as jamais touchés et laisse tranquille chaque fichier dont la somme de contrôle montre que tu l’as modifié — `--force` passe outre, `--dry-run` montre d’abord le plan. Lance ensuite `tale deploy` pour faire tourner les conteneurs.

## Cursor : plan config vs plan runtime

Cursor apparaît dans Tale à deux endroits distincts — ne les confonds pas. Le **plan config**, c’est cette page : `AGENTS.md`, `CLAUDE.md` et `.tale/reference/` guident Cursor pendant qu’il édite la configuration sur ta machine. Le **plan runtime**, c’est un [agent de projet](/fr/platform/projects/project-agents) dont le **Harness** est Cursor : Tale lance la CLI Cursor Agent (`agent -p`) en mode headless dans une sandbox isolée avec ta `CURSOR_API_KEY` et rend compte sur la tâche, sans jamais toucher ta copie de travail. Credentials, modèles et facturation de ce plan sont dans [Harnesses](/fr/platform/agents/harnesses), pas ici.

## Où cela se place

Le développement assisté par IA est le chemin d’édition ; `tale deploy` est le chemin de publication. L’agent lit `AGENTS.md`, consulte `.tale/reference/` et édite des fichiers sous `default/` ; tu relis le diff, tu regardes le résultat en local avec `tale dev` et tu publies avec `tale deploy` — avec `--override` quand la modification doit écraser la configuration que les conteneurs tiennent déjà. La CLI elle-même, ses commandes et ses options, est documentée sous [Installer la CLI tale](/fr/self-hosted/install/cli-install).

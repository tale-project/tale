---
title: Configurer Tale avec un agent de programmation
description: Fournis le bon contexte à un agent, distingue les modèles de la configuration active et vérifie les changements avant le déploiement.
---

Un agent de programmation peut t’aider à modifier un projet de configuration Tale géré par la CLI. Le projet fournit des instructions, des exemples et une sélection de code source de référence. Il reste nécessaire de relire la proposition et d’identifier les organisations concernées.

Modifier le code applicatif de Tale suit un autre parcours. Pour cela, commence par [Préparer l’environnement de développement](/fr/develop/contributor-setup) et le fichier `AGENTS.md` du dépôt.

## Préparer un projet

Installe la [CLI Tale](/fr/self-hosted/install/cli-install), puis crée le projet de configuration dans un nouveau répertoire :

```bash
tale init agent-config-example --no-env
cd agent-config-example
ls -a
```

Voici un extrait des chemins générés :

```text
AGENTS.md
CLAUDE.md
default/
.gitignore
.tale/
tale.json
```

`--no-env` saute la préparation de l’environnement : il ne crée ni installation prête à démarrer ni fichier `.env`. Cette option permet d’examiner la configuration avant de lancer des conteneurs. `tale dev` prépare l’environnement lorsque tu démarres ensuite en local. Vérifie d’abord les [prérequis du démarrage rapide](/fr/self-hosted/install/quickstart).

Ouvre ce répertoire dans ton éditeur. Demande à l’agent de lire `AGENTS.md`, les configurations existantes pertinentes et les sources sous `.tale/reference/` avant de proposer un changement.

## Les deux fichiers d’instructions

`AGENTS.md` contient les consignes de configuration Tale. `CLAUDE.md` y renvoie pour conserver une seule version des instructions. La CLI reconnaît aussi un fichier `AGENT.md` existant ou un `CLAUDE.md` déjà placé dans `.claude/`.

La CLI gère la section comprise entre les commentaires `tale:begin` et `tale:end`. Place tes conventions propres au projet en dehors de cette section ; l’initialisation et les mises à jour conservent ce texte environnant. N’inscris d’identifiants dans aucun de ces fichiers.

La CLI ne génère pas de règles distinctes pour Cursor, Windsurf ou Copilot. Si l’éditeur ne charge pas automatiquement les instructions du projet, ajoute-les explicitement au contexte de l’agent. Consulte les schémas réels au lieu de te fier à sa connaissance d’une ancienne version.

## Comprendre les répertoires

| Chemin | Utilisation |
| --- | --- |
| `default/agents/` | Catalogue de configurations d’agents, avec l’exemple d’agent de programmation fourni. |
| `default/automations/` | Automatisations disponibles à installer ou à déployer. Un fichier présent sur disque n’est pas nécessairement actif. |
| `default/skills/` | Bundles de skills pour les documents et l’analyse visuelle ; chaque bundle occupe un répertoire. |
| `default/branding/` | Configuration de marque et images du modèle. |
| `default/governance/` | Exemples de politiques et de conservation. Respecte les formats produits par ta CLI. |
| `default/README.md` | Explique le modèle et les éléments du catalogue installés automatiquement. |
| `.tale/reference/` | Sélection de sources embarquées dans la CLI. Consulte-la sans y maintenir de modifications : la régénération les remplace. Ce n’est pas une copie complète du dépôt. |
| `.tale/orgs/<slug>/<domain>/` | Configuration d’exécution des organisations réellement créées dans l’application. |
| `.tale/checksums.json` | Empreintes des fichiers générés, utilisées pour reconnaître tes modifications lors des mises à jour. |

`default/` est le modèle des nouvelles organisations, pas une organisation à déployer. Le modifier ne met pas automatiquement à jour une organisation existante. Git ignore `.tale/` et les fichiers secrets ; les modèles publics sont destinés à la gestion de versions.

## Actualiser la référence

`tale update` actualise la CLI dans sa série de versions et renouvelle les contenus générés. La commande régénère la référence, met à jour les sections d’instructions gérées, ajoute les nouveaux fichiers du catalogue et remplace ceux dont l’empreinte ne révèle aucune modification locale. Les fichiers du catalogue que tu as modifiés restent inchangés, sauf avec `--force`.

Examine le plan avec `tale update --dry-run`. Versionne la configuration publique et conserve des sauvegardes protégées de la configuration d’exécution et des secrets. Ne maintiens pas un fork dans `.tale/reference/`. Actualiser la CLI ne remplace pas les conteneurs en service ; suis [Mises à jour](/fr/self-hosted/operate/upgrades) pour changer la version déployée.

## Cursor dans l’éditeur et dans Tale

Un agent de l’éditeur modifie les fichiers de configuration locaux. Un [agent de projet](/fr/platform/projects/project-agents) Tale utilisant le harness Cursor travaille dans une sandbox gérée par Tale. Ces contextes d’exécution ont des identifiants et des conséquences distincts.

Le harness de la sandbox utilise son compte fournisseur et son modèle configurés. Ajouter les instructions à ton éditeur ne configure pas ce compte. Consulte [Harnesses](/fr/platform/agents/harnesses) pour préparer l’exécution dans Tale.

## Examiner et appliquer une proposition

1. Demande un changement précis et indique s’il vise le modèle des nouvelles organisations ou une organisation existante.
2. Vérifie chaque chemin, champ de schéma, slug et référence d’identifiants. Garde les secrets hors du prompt et du diff public.
3. Valide ou teste dans la surface produit correspondante. Pour une automatisation, examine la validation et les tests simulés avant de la déployer.
4. Contrôle le plan de déploiement et l’organisation cible. `tale deploy --override` peut remplacer la configuration d’exécution par la copie locale ; réserve-le à un remplacement délibéré et relu.
5. Relis la configuration enregistrée et teste le comportement après le déploiement.

Si l’agent propose un champ absent du schéma installé, corrige la proposition avant d’appliquer le changement. Si modifier `default/` ne change pas une organisation existante, vérifie la destination au lieu de redéployer le modèle à répétition.

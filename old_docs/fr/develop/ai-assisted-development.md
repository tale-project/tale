---
title: Développement assisté par l'IA
description: Utiliser des éditeurs IA pour créer agents, workflows et intégrations avec un contexte de plateforme complet.
---

Les commandes CLI `tale init` et `tale upgrade` génèrent des fichiers de configuration d'éditeur qui rendent les éditeurs IA — Claude Code, Cursor, GitHub Copilot, Windsurf — conscients de la structure de projet, des schémas et du code source de plateforme de Tale. Avec ces fichiers en place, tu peux décrire un agent, un workflow ou une intégration en langage naturel, et l'éditeur produit une configuration conforme au schéma. Cette page s'adresse aux contributeurs source et aux développeurs avec un workflow d'écriture basé sur fichiers ; les utilisateurs qui éditent par l'UI de la plateforme n'ont besoin de rien de tout ça.

Le résultat d'un seul `tale init` est un répertoire de projet que n'importe lequel des éditeurs nommés peut ouvrir avec un contexte complet : les schémas, les validateurs, la surface d'outils de connecteur et la bibliothèque d'exemples vivent tous sous `.tale/reference/`.

## Ce que `tale init` génère

Un projet échafaudé livre un fichier de règles d'éditeur par éditeur pris en charge, plus un répertoire de référence en lecture seule que l'éditeur peut parcourir :

| Fichier                           | Rôle                                 | Éditeur            |
| --------------------------------- | ------------------------------------ | ------------------ |
| `CLAUDE.md`                       | Règles et contexte du projet         | Claude Code        |
| `.cursor/rules/tale.mdc`          | Règles avec frontmatter à motif glob | Cursor             |
| `.github/copilot-instructions.md` | Règles du projet                     | GitHub Copilot     |
| `.windsurfrules`                  | Règles du projet                     | Windsurf           |
| `.tale/reference/`                | Source de plateforme (lecture seule) | tous les ci-dessus |

Les quatre fichiers de règles portent le même contenu central — structure de projet, conventions de configuration, instruction de consulter `.tale/reference/` avant de générer quoi que ce soit — dans le format préféré de chaque éditeur. Le répertoire de référence contient l'implémentation backend : schémas de base de données, validateurs, définitions d'outils d'agent, types d'étapes de workflow et contrats de connecteur. C'est tout ce qu'il faut à l'éditeur pour produire une configuration correcte sans deviner.

## Comment l'utiliser

Le workflow est le même pour chaque éditeur :

1. Crée ou mets à jour le projet : `tale init <nom-de-projet>` pour un arbre frais, `tale upgrade` pour régénérer les fichiers de règles dans un existant.
2. Ouvre le projet dans l'éditeur IA de ton choix. L'éditeur prend en charge le fichier de règles automatiquement.
3. Décris en langage simple ce que tu veux. L'éditeur lit les schémas sous `.tale/reference/` et écrit les fichiers de configuration correspondants.
4. Enregistre. La plateforme Tale recharge à chaud `agents/`, `workflows/`, `integrations/` et `branding/` — pas d'étape de déploiement séparée.

Quelques prompts qui marchent bien en pratique :

```text
Crée un agent qui aide l'équipe commerciale à consulter les détails produits et l'historique client.
```

```text
Ajoute un workflow qui tourne chaque matin, vérifie les factures en retard et poste un résumé sur Slack.
```

```text
Crée une intégration REST API pour notre service interne sur api.example.com avec authentification OAuth2.
```

```text
Mets à jour l'agent assistant CRM pour qu'il ait aussi accès à l'outil de recherche documentaire.
```

L'éditeur génère le JSON, tu le revois, la plateforme l'applique.

## Garder règles et référence à jour

Les fichiers de règles et le répertoire de référence sont empaquetés dans le binaire CLI, donc une CLI obsolète produit des règles obsolètes. Lance `tale upgrade` régulièrement :

```bash
tale upgrade
```

L'upgrade réécrit chaque fichier généré. Ne les édite pas à la main — les modifications locales sont écrasées au prochain upgrade. Si une règle doit changer pour tout le projet (une convention maison, un style), soumets le changement contre la CLI elle-même plutôt que de patcher le fichier généré.

## Où ça s'inscrit

Le développement assisté par l'IA est le chemin d'écriture par fichier pour agents, automatisations, intégrations et branding. Il existe parce que la forme JSON qui sous-tend chaque écran d'UI est aussi la forme qu'un éditeur IA peut générer depuis une description en langage clair — pour une flotte d'agents, c'est plus rapide que d'en construire chacun dans l'UI.

Pour le chemin de construction canonique par UI sans éditeur de code, [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) est le point d'entrée. Pour la surface d'écriture de connecteur à côté de laquelle cette page se situe, [Construire une intégration](/fr/develop/integrations) est la référence.

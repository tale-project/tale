---
title: Développement assisté par l'IA
description: Utilise des éditeurs IA pour créer et modifier agents, workflows et intégrations avec contexte complet.
---

Quand tu lances `tale init`, le CLI génère des fichiers de configuration qui rendent les éditeurs de code IA conscients de la structure projet, des schémas et du code source plateforme de Tale. Tu peux ainsi créer et modifier agents, workflows et intégrations en décrivant ce que tu veux en langage naturel.

## Ce qui est généré

| Fichier                           | Rôle                                       | Éditeur             |
| --------------------------------- | ------------------------------------------ | ------------------- |
| `CLAUDE.md`                       | règles et contexte projet                  | Claude Code         |
| `.cursor/rules/tale.mdc`          | règles avec frontmatter glob               | Cursor              |
| `.github/copilot-instructions.md` | règles projet                              | GitHub Copilot      |
| `.windsurfrules`                  | règles projet                              | Windsurf            |
| `.tale/reference/`                | code source plateforme complet (read-only) | tous les précédents |

Les fichiers de règles contiennent le même cœur : structure projet, conventions de config et instruction de consulter `.tale/reference/` avant toute modification. Le répertoire reference contient tout le code source backend — schémas DB, validators, outils d'agent, types d'étape workflow et connecteurs d'intégration. L'IA a tout ce qu'il faut pour générer des configurations correctes.

## Comment l'utiliser

1. Crée un projet avec `tale init my-project` (ou `tale upgrade` dans un projet existant pour regénérer).
2. Ouvre le répertoire dans ton éditeur IA.
3. L'éditeur lit automatiquement son fichier de règles et prend le contexte complet.
4. Demande à l'IA de créer ou modifier des configurations. Par exemple :
   - « Crée un agent qui aide l'équipe sales à chercher les détails produit et l'historique client. »
   - « Ajoute un workflow qui tourne chaque matin, vérifie les factures en retard et envoie un résumé sur Slack. »
   - « Crée une intégration REST API pour notre service interne sur api.example.com avec OAuth2. »
   - « Donne à l'agent CRM l'accès supplémentaire à l'outil document search. »
5. L'IA lit le code source reference, comprend les schémas et relations valides, et génère les JSON de configuration corrects.
6. Les changements dans `agents/`, `workflows/`, `integrations/` et `branding/` sont hot-reloaded par la plateforme.

## Éditeurs supportés

Tale génère des fichiers pour Claude Code, Cursor, GitHub Copilot et Windsurf. Tout éditeur qui lit l'un de ces formats marche. Pour d'autres outils, le `CLAUDE.md` à la racine sert de référence générale.

## Garder les règles à jour

Les fichiers de règles et le répertoire reference sont dans le binaire CLI. Lance `tale upgrade` pour récupérer le dernier CLI et regénérer :

```bash
tale upgrade
```

Ne modifie pas ces fichiers à la main, ils sont écrasés à l'upgrade.

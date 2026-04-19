---
title: Versions des agents
description: Itère sur un agent en production en toute sécurité avec draft, publication et rollback.
---

Les agents utilisent un modèle draft-et-publish pour que tu puisses itérer sans gêner les utilisateurs en train de discuter.

## Draft vs Live

Chaque agent a deux états à tout moment :

- **Version Live** — celle qui sert les requêtes. C'est ce que voient les utilisateurs quand ils choisissent l'agent, et ce qu'appellent les webhooks et délégations.
- **Version Draft** — ton travail en cours. Modifier les instructions, connaissances ou outils met à jour la draft. Rien ne change pour les utilisateurs avant publication.

En haut à droite de l'éditeur d'agent, un indicateur montre quelle version tu regardes — **Draft** ou **Live** — et permet de basculer.

## Publier une draft

Quand tu es content de la draft, clique **Publish**. Publier :

1. enregistre la version Live précédente dans l'historique ;
2. fait de la draft la nouvelle version Live ;
3. efface l'état draft. Les prochaines modifications démarrent une draft fraîche.

Toute conversation en train de répondre au moment du publish termine avec sa version d'origine — personne ne voit un changement de personnalité en plein tour.

## Historique des versions

Le dialogue d'historique liste chaque version publiée avec auteur, date de publication et résumé des changements. Pour chaque version passée, tu peux :

- **Compare** — diff de ses instructions face à la version Live actuelle.
- **Restore** — en faire la nouvelle draft, que tu peux ensuite publier.

## Rollback

Si une modification publiée pose problème — ton erroné, mauvaises réponses, accès d'outil cassé — ouvre l'historique, choisis la dernière version connue bonne et clique **Restore** puis **Publish**. Le rollback est immédiat pour toutes les nouvelles conversations.

## Agents par fichier

Les agents définis dans `TALE_CONFIG_DIR/agents/*.json` n'utilisent pas le système de versions UI — leur historique est ce que ton dépôt git enregistre. Voir [AI-assisted development](/fr/develop/ai-assisted-development) pour le workflow par fichier.

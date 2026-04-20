---
title: Versions des agents
description: Itère sur un agent en production en toute sécurité avec brouillon, publication et rollback.
---

Les agents utilisent un modèle brouillon-et-publication pour que tu puisses itérer sans gêner les utilisateurs en train de discuter.

## Brouillon vs Actif

Chaque agent a deux états à tout moment :

- **Version active** — celle qui sert les requêtes. C'est ce que voient les utilisateurs quand ils choisissent l'agent, et ce qu'appellent les webhooks et délégations.
- **Brouillon** — ton travail en cours. Modifier les instructions, connaissances ou outils met à jour le brouillon. Rien ne change pour les utilisateurs avant publication.

En haut à droite de l'éditeur d'agent, un indicateur montre quelle version tu regardes — **Brouillon** ou **Actif** — et permet de basculer.

## Publier un brouillon

Quand tu es content du brouillon, clique **Publier**. Publier :

1. enregistre la version active précédente dans l'historique ;
2. fait du brouillon la nouvelle version active ;
3. efface l'état brouillon. Les prochaines modifications démarrent un nouveau brouillon.

Toute conversation en train de répondre au moment de la publication termine avec sa version d'origine — personne ne voit un changement de personnalité en plein tour.

## Historique des versions

Le dialogue d'historique liste chaque version publiée avec auteur, date de publication et résumé des changements. Pour chaque version passée, tu peux :

- **Comparer** — diff de ses instructions face à la version active actuelle.
- **Restaurer** — en faire le nouveau brouillon, que tu peux ensuite publier.

## Rollback

Si une modification publiée pose problème — ton erroné, mauvaises réponses, accès d'outil cassé — ouvre l'historique, choisis la dernière version connue bonne et clique **Restaurer** puis **Publier**. Le rollback est immédiat pour toutes les nouvelles conversations.

## Agents par fichier

Les agents définis dans `TALE_CONFIG_DIR/agents/*.json` n'utilisent pas le système de versions UI — leur historique est ce que ton dépôt git enregistre. Voir [AI-assisted development](/fr/develop/ai-assisted-development) pour le workflow par fichier.

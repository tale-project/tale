---
title: Tutoriels
description: Guides end-to-end orientés tâche, pour chaque rôle Tale.
---

Les tutoriels sont des pas-à-pas qui te mènent de « je veux faire X » à un résultat concret. Ils complètent la référence [Platform](/fr/platform) : la référence décrit ce que chaque fonctionnalité fait isolément, les tutoriels montrent comment les combiner pour atteindre un objectif concret. Utilise Platform quand tu connais déjà la fonctionnalité et cherches du détail ; utilise cette section quand tu veux un chemin guidé.

Les tutoriels sont groupés par rôle pour que tu atterrisses sur du contenu que tu peux vraiment exécuter. Les permissions suivent le [modèle à six rôles](/fr/platform/admin/members-and-roles) — si un tutoriel vit sous Admin, il te faut un siège Admin ou Propriétaire pour le terminer.

## Par rôle

- **Membre** — [Chatter efficacement](/fr/tutorials/member/chat-effectively) : combiner agents, pièces jointes et dictée dans un workflow quotidien.
- **Éditeur** — [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) : créer un agent, brancher du savoir, tester, publier une version.
- **Développeur** — [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) et [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
- **Admin** — [Add-in Word & Excel](/fr/tutorials/admin/office-add-in), [Transcription de réunions](/fr/tutorials/admin/meeting-transcription) et [Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider).

## Prérequis valables pour tous les tutoriels

- Une instance Tale joignable — Cloud ou [auto-hébergée](/fr/self-hosted).
- Un compte sur cette instance. Les tutoriels liés à un rôle le précisent en tête.
- Pour les tutoriels qui appellent l'API, une clé API depuis **Paramètres > Clés API**. La création est réservée aux Admins ; voir [Membres et rôles](/fr/platform/admin/members-and-roles).

Si une étape suppose autre chose que ce qui est listé ci-dessus, le tutoriel concerné l'indique dans sa propre section prérequis.

## Comment travailler un tutoriel

Les tutoriels sont écrits pour s'exécuter dans l'ordre, du haut vers le bas, sur une instance fraîche. Si tu sautes une section en supposant que tu as déjà le prérequis, vérifie deux fois — l'étape suivante dépend souvent du champ exact que la section sautée configure. Quand quelque chose échoue, la page [Journaux d'exécution](/fr/platform/automations/execution-logs) (pour les automatisations) et l'historique de conversation (pour les agents) suffisent en général à diagnostiquer sans retourner au tutoriel.

## Où ça s'inscrit

Les tutoriels sont la couche d'exemples travaillés de la documentation. Ils prennent un résultat réel — un add-in Office, un agent qui résume des réunions, un script qui appelle l'API — et déroulent chaque étape nécessaire pour y arriver. Pour le modèle mental conceptuel derrière chaque tutoriel, la page correspondante sous [Platform](/fr/platform) est la référence ; pour les surfaces API et SDK plus larges sur lesquelles les tutoriels développeurs reposent, [Develop](/fr/develop/api-reference) est un onglet plus loin.

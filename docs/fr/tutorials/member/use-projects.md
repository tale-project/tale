---
title: Utiliser un projet pour partager le contexte
description: Crée un projet, ajoute des fichiers et des instructions, puis pose une question sur ses connaissances.
---

Crée un projet lorsque plusieurs chats ont besoin des mêmes documents. Dans ce parcours, tu vas préparer un espace de travail, ajouter un fichier et vérifier qu’un chat du projet peut l’utiliser. Prévois environ dix minutes, auxquelles s’ajoute le temps d’indexation du fichier.

## Avant de commencer

Il te faut le rôle **Membre** ou supérieur et un court document texte, un PDF dont le texte est sélectionnable ou un fichier Office récent. Choisis un contenu vérifiable, par exemple un brief qui nomme une personne responsable et une date de revue. Un admin doit avoir configuré le stockage documentaire et un modèle d’embedding pour rendre les fichiers consultables.

Les nouveaux projets sont accessibles à **Toute l'organisation**. Utilise un document sans données sensibles pour ce parcours. Si ton projet doit être restreint, choisis son équipe propriétaire sous **Général > Partage** avant d’importer ses fichiers. Les chats du projet restent personnels tant que tu ne les partages pas.

## Créer le projet

1. Dans **Accueil**, clique sur **Nouveau projet**, l’icône de dossier à côté de **Projets**.
2. Renseigne **Nom du projet** avec un nom reconnaissable, par exemple `Refonte du site`.
3. Vérifie la **Clé du projet**, le préfixe des identifiants de tâches tels que `WEB-1`. Elle ne peut plus être modifiée après la création.
4. Ajoute une **Description** si nécessaire, puis clique sur **Créer le projet**.

Le projet s’ouvre sur **Tâches** et apparaît sous **Projets** dans **Accueil**. Sa navigation comprend aussi **Général**, **Chats**, **Connaissances** et **Agents**. Tu n’as pas besoin de créer un agent pour utiliser le chat du projet.

## Ajouter un fichier de référence

Ouvre **Connaissances** dans le projet et clique sur **Ajouter un fichier**, ou dépose le fichier dans la zone d’import. Il apparaît dans l’arborescence du projet. Attends le statut **Indexé** avant de te fier à la recherche ; **En file d'attente** et **Indexation…** indiquent que la préparation continue.

<Frame caption="L’onglet Connaissances conserve les fichiers du projet. Le statut de chaque fichier indique s’il est consultable.">

![L’onglet Connaissances du projet Website relaunch affiche deux fichiers indexés et les commandes pour ajouter des fichiers et des dossiers.](/images/platform/project-knowledge-files.webp)

</Frame>

Un fichier ajouté ici appartient à ce projet. Pose tes questions à son sujet dans un chat du projet. Le chat général de l’organisation ne recherche pas dans les fichiers des projets.

## Donner des instructions à tous les chats du projet

Ouvre **Général**, puis décris dans **Instructions** le contexte ou les contraintes que chaque chat doit suivre. Par exemple :

> Utilise les fichiers du projet pour répondre aux questions sur ce lancement. Cite la source des dates et des décisions. Si la date de lancement n’a pas été approuvée, indique qu’elle reste à confirmer.

Clique sur **Enregistrer** en haut de la page. Ces instructions font partie du contexte des chats du projet. Elles ne remplacent ni l’import des documents ni leur consultation par l’assistant.

<Frame caption="Les instructions se trouvent dans Général, avec le nom et la description du projet.">

![L’onglet Général contient le nom du projet, sa description, l’éditeur d’instructions et la section Partage, avec Enregistrer et Abandonner dans l’en-tête.](/images/platform/project-general-tab.webp)

</Frame>

## Poser une question et vérifier la source

Ouvre **Chats** et clique sur **Nouveau chat**. Garde **Auto** lorsqu’il est proposé, puis pose une question dont la réponse figure dans ton fichier. Pour un brief de lancement, essaie :

> Lis le brief de lancement. Qui est responsable de la revue, et quelles dates sont confirmées ? Cite le fichier et distingue les dates confirmées des décisions encore ouvertes.

Consulte les étapes de recherche et de lecture au-dessus de la réponse, puis compare les informations avec le fichier. Une réponse fluide sans source pertinente ne prouve pas que Tale a utilisé ton document. Rouvre **Connaissances** pour examiner l’original si nécessaire.

<Tip>

Nomme le document et pose une question précise. « Quelle date de revue est confirmée dans le brief de lancement ? » donne une cible plus claire que « Parle-moi du projet ».

</Tip>

## Partager une conversation utile

L’onglet **Chats** sépare **Tes chats** et **Partagés avec le projet**. Active **Partager avec le projet** lorsqu’un chat doit être lisible par les personnes ayant accès au projet. Ajouter des fichiers au projet ne partage pas automatiquement tes chats.

Pour envoyer un lien vers un instantané aux membres de l’organisation, suis [Chats partagés](/fr/platform/chat/shared-threads). Relis la conversation avant de la partager : elle peut reprendre des informations issues de sources dont l’accès est plus restreint.

## Si le fichier manque dans la réponse

| Ce que tu observes | Vérification |
| --- | --- |
| L’import échoue avant qu’une ligne apparaisse | Réessaie avec un petit fichier dans un format accepté. Si l’échec se répète, demande à un admin de vérifier le stockage et la politique d’import. |
| **En file d'attente** ou **Indexation…** | Attends la fin du traitement, puis repose la question. |
| **Échec** | Utilise **Réessayer l'indexation**. Si le problème revient, demande à un admin de vérifier le modèle d’embedding et le service de connaissances. |
| **Non indexé** | Utilise **Indexer maintenant** lorsque cette action est proposée. Pour un ancien fichier Office sans extracteur compatible, enregistre-le dans le format récent. |
| **Indexé**, mais aucune source pertinente dans la réponse | Vérifie que le chat appartient au projet, nomme le fichier et demande une information précise. Compare la réponse avec l’original. |

Les sources et les conversations du projet ont maintenant un emplacement commun. Ajoute une tâche au [tableau du projet](/fr/platform/projects/tasks) lorsque le travail demande un responsable, une échéance ou un résultat à examiner.

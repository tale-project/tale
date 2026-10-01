---
title: Utiliser un projet pour partager le contexte
description: Pose une question à laquelle répondent les fichiers d’un projet, partage la conversation et confie la suite à un agent du projet.
---

Un projet réunit les fichiers, les instructions, les conversations et les tâches d’un même travail. Dans ce parcours, tu poses une question à laquelle répond un fichier de référence du projet, tu partages la conversation utile et tu confies le livrable qui en découle à l’un des agents du projet. Prévois environ quinze minutes, auxquelles s’ajoutent le temps d’indexation et celui de l’exécution de l’agent.

## Avant de commencer

En tant que **Membre**, tu travailles dans les projets partagés avec toi : tu poses des questions dans leurs chats, tu partages des conversations et tu crées des tâches pour les agents du projet. Prends un projet que tu peux ouvrir, avec un fichier de référence indexé, puis commence à [Poser une question et vérifier la source](#poser-une-question-et-verifier-la-source). Un projet sans agents propres confie ses tâches à l’[agent standard](/fr/platform/projects/project-agents#standard-agent) de l’organisation, sauf si un admin l’a désactivé. Créer un projet, importer ses fichiers, enregistrer ses instructions et ajouter des agents demandent le rôle **Éditeur** ou supérieur ; si tu prépares le projet, commence à [Préparer le projet](#preparer-le-projet). Il te faut un court document texte, un PDF dont le texte est sélectionnable ou un fichier Office récent. Choisis un contenu vérifiable, par exemple un brief qui nomme une personne responsable et une date de revue. Un admin doit avoir configuré le stockage documentaire et un modèle d’embedding pour rendre les fichiers consultables.

Les nouveaux projets sont accessibles à **Toute l'organisation**. Utilise un document sans données sensibles pour ce parcours. Si ton projet doit être restreint, choisis son équipe propriétaire sous **Général > Partage** avant d’importer ses fichiers. Les chats du projet restent personnels tant que tu ne les partages pas.

## Préparer le projet

Les Éditeurs et les rôles supérieurs le font une fois par projet. Les Membres passent directement à [Poser une question et vérifier la source](#poser-une-question-et-verifier-la-source).

### Créer le projet

1. Dans **Accueil**, clique sur **Nouveau projet**, l’icône de dossier à côté de **Projets**.
2. Renseigne **Nom du projet** avec un nom reconnaissable, par exemple `Refonte du site`.
3. Vérifie la **Clé du projet**, le préfixe des identifiants de tâches tels que `WEB-1`. Elle ne peut plus être modifiée après la création.
4. Ajoute une **Description** si nécessaire, puis clique sur **Créer le projet**.

Le projet s’ouvre sur **Tâches** et apparaît sous **Projets** dans **Accueil**. Sa navigation comprend aussi **Général**, **Chats**, **Connaissances** et **Agents**. Tu n’as pas besoin de créer un agent pour utiliser le chat du projet.

### Ajouter un fichier de référence

Ouvre **Connaissances** dans le projet et clique sur **Ajouter un fichier**, ou dépose le fichier dans la zone d’import. Il apparaît dans l’arborescence du projet. Attends le statut **Indexé** avant de te fier à la recherche ; **En file d'attente** et **Indexation…** indiquent que la préparation continue.

<Frame caption="L’onglet Connaissances conserve les fichiers du projet. Le statut de chaque fichier indique s’il est consultable.">

![L’onglet Connaissances du projet Website relaunch affiche deux fichiers indexés et les commandes pour ajouter des fichiers et des dossiers.](/images/platform/project-knowledge-files.webp)

</Frame>

Un fichier ajouté ici appartient à ce projet. Pose tes questions à son sujet dans un chat du projet. Le chat général de l’organisation ne recherche pas dans les fichiers des projets.

### Donner des instructions à tous les chats du projet

Ouvre **Général**, puis décris dans **Instructions** le contexte ou les contraintes que chaque chat doit suivre. Par exemple :

> Utilise les fichiers du projet pour répondre aux questions sur ce lancement. Cite la source des dates et des décisions. Si la date de lancement n’a pas été approuvée, indique qu’elle reste à confirmer.

Clique sur **Enregistrer** en haut de la page. Ces instructions font partie du contexte des chats du projet. Elles ne remplacent ni l’import des documents ni leur consultation par l’assistant.

<Frame caption="Les instructions se trouvent dans Général, avec le nom et la description du projet.">

![L’onglet Général contient le nom du projet, sa description, l’éditeur d’instructions et la section Partage, avec Enregistrer et Abandonner dans l’en-tête.](/images/platform/project-general-tab.webp)

</Frame>

La dernière partie de ce parcours confie une tâche à un agent : l’un des agents du projet ou, tant qu’il n’en a pas, l’[agent standard](/fr/platform/projects/project-agents#standard-agent) de l’organisation. [Agents du projet](/fr/platform/projects/project-agents) explique comment en ajouter un.

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

## Confier la suite à un agent du projet

Le chat répond aux questions ; il ne produit pas de fichiers. Quand la réponse doit devenir un document, par exemple une synthèse de lancement d’une page, confie le travail à l’un des agents du projet au moyen d’une tâche.

1. Dans l’en-tête de la conversation, sélectionne **Créer une tâche**. Comme le chat appartient à ce projet, **Créer une tâche** s’y ouvre, avec ta dernière question comme description, un lien vers le chat et les fichiers que tu as joints.
2. Reformule la description en résultat attendu, par exemple : `Rédige à partir du brief une synthèse de lancement d’une page au format Word. Cite le brief pour chaque date.`
3. Sous **Assigné à**, choisis l’un des agents du projet si aucun n’est encore choisi ; dans un projet sans agents propres, l’agent standard l’est déjà. Sélectionne ensuite **Créer et démarrer l'agent**.
4. Suis l’exécution au-dessus du champ de message du chat ; **Ouvrir** te mène alors à la tâche.

À la fin de l’exécution, le rapport de l’agent se trouve dans les commentaires de la tâche, le fichier sous **Fichiers produits**, et la tâche attend en **En revue**. Mentionne l’agent avec `@` dans un commentaire pour demander des modifications, et passe la tâche à **Terminé** lorsque le résultat correspond à la description.

Toute personne qui peut ouvrir un projet peut y créer des tâches. Une exécution démarrée par un Membre reste limitée à cette tâche et à ses sous-tâches, sans les secrets de l’agent ; [Exécutions démarrées par un Membre](/fr/platform/projects/tasks#executions-demarrees-par-un-membre) détaille ces limites.

## Si le fichier manque dans la réponse

| Ce que tu observes | Vérification |
| --- | --- |
| L’import échoue avant qu’une ligne apparaisse | Réessaie avec un petit fichier dans un format accepté. Si l’échec se répète, demande à un admin de vérifier le stockage et la politique d’import. |
| **En file d'attente** ou **Indexation…** | Attends la fin du traitement, puis repose la question. |
| **Échec** | Utilise **Réessayer l'indexation**. Si le problème revient, demande à un admin de vérifier le modèle d’embedding et le service de connaissances. |
| **Non indexé** | Utilise **Indexer maintenant** lorsque cette action est proposée. Pour un ancien fichier Office sans extracteur compatible, enregistre-le dans le format récent. |
| **Indexé**, mais aucune source pertinente dans la réponse | Vérifie que le chat appartient au projet, nomme le fichier et demande une information précise. Compare la réponse avec l’original. |

Le projet réunit désormais ses sources, ses conversations et ses tâches. [Gérer les tâches du projet](/fr/platform/projects/tasks) présente le tableau, la revue et le travail récurrent.

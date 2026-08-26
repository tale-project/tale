---
title: Utiliser les projets pour grouper fichiers et chats
description: Transforme un chat ponctuel en espace de travail partagé qui garde ensemble les mêmes fichiers, instructions et conversations — et arrête de re-charger les mêmes documents à chaque fois.
---

Un projet est ce vers quoi tu te tournes la deuxième fois que tu te surprends à coller le même contexte dans un chat. Il regroupe fichiers, instructions et chats autour d'une seule chose à faire — un contact, un lancement, une longue enquête — pour que chaque nouvelle conversation démarre avec le contexte déjà chargé. Ce parcours mène un projet neuf de « je recharge sans cesse le même brief » à « chaque chat dans ce projet connaît déjà le brief » sur une seule instance.

Il te faut un rôle Membre (le plancher pour créer un projet) et trois ou quatre fichiers que tu référence régulièrement. Le côté conceptuel vit dans [Concepts de projet](/fr/platform/projects/concepts) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme deux choses. Ton rôle est au moins Membre — la création de projet est verrouillée à Membre et au-dessus. Tu as trois à quatre fichiers qui reviennent dans les chats que tu as eus — un brief, une transcription, une liste de prix, une politique. Ils deviennent l'ensemble de travail du projet.

## Étape 1 — Créer le projet

Le projet est le conteneur dans lequel vivent les autres pièces. Ouvre **Projets > Nouveau projet** et règle :

- **Nom** — `Compte Acme` (ou ce qui nomme la chose à faire)
- **Description** — une phrase sur l'objet du projet
- **Membres** — laisse en privé pour l'instant ; tu pourras ajouter des coéquipiers après que le premier chat marche

Enregistre. Le projet apparaît dans la sidebar ; un clic ouvre le tableau **Tâches**, avec des onglets pour Général, Chats, Connaissances et Agents.

## Étape 2 — Charger les fichiers une seule fois

Les fichiers du projet sont visibles pour chaque chat dans le projet, donc ce chargement se fait une fois et se rembourse à chaque chat ultérieur. Ouvre l'onglet **Connaissances** et glisse les trois ou quatre fichiers confirmés dans les prérequis.

Chaque fichier atterrit dans le stockage du projet et s'indexe comme un document de base de connaissances. Une fois le statut **Prêt**, n'importe quel chat démarré dans le projet peut atteindre les fichiers.

## Étape 3 — Ajouter les instructions du projet

Les instructions du projet encadrent chaque chat dans le projet. Elles composent avec les propres instructions de l'agent : le projet cadre le travail, l'agent cadre la réponse. Ouvre l'onglet **Instructions** et règle :

`You are working on the Acme account. The contract and the call notes in the Knowledge tab are the source of truth; cite them when you make a claim. The customer's voice is conservative — drafts should not promise dates we have not confirmed.`

Enregistre. Chaque nouveau chat du projet tournera désormais avec ce préambule en plus des propres instructions de l'agent.

## Étape 4 — Démarrer un chat et vérifier que le contexte suit

Ouvre l'onglet **Threads** et clique **Nouveau chat**. Choisis un agent — l'Assistant par défaut suffit pour le premier run — et pose une question à laquelle un des fichiers du projet répond (`What does the contract say about the renewal clause?`). La réponse doit citer le contrat ; la citation ouvre le fichier depuis l'onglet Connaissances du projet, pas depuis la bibliothèque de l'organisation.

Si l'agent répond sans citer, les fichiers du projet n'ont pas été récupérés — généralement parce que l'agent choisi n'a pas de tool de retrieval activé. Passe à un agent avec RAG actif, ou active-le sur l'Assistant pour l'usage projet.

## Où ça s'utilise

Un projet avec fichiers, instructions et threads est la plus petite unité utile de contexte partagé dans Tale. La même forme passe à l'échelle — ajoute des membres pour qu'une équipe travaille le projet ensemble, ajoute un agent à périmètre projet pour verrouiller la voix, archive le projet quand le travail est livré.

Pour le modèle plus profond de ce qu'est un projet et de quand on s'en sert, voir [Concepts de projet](/fr/platform/projects/concepts). Pour les agents à périmètre projet, voir [Agents de projet](/fr/platform/projects/project-agents).

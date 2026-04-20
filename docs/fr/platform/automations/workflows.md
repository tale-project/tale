---
title: Workflows
description: Construis et exécute des workflows multi-étapes avec triggers, conditions, boucles et étapes IA.
---

Les automatisations te permettent de définir et exécuter des processus métier multi-étapes sans écrire de code backend. Un workflow est une suite d'étapes. Chaque étape fait une chose, et les étapes sont connectées pour former un processus complet.

## Créer un workflow

Trois façons de créer un workflow :

### Avec assistance IA

1. Va dans Automatisations et clique **Nouvelle automatisation**.
2. Entre un nom et une description de ce que le workflow doit faire. Plus tu détailles, mieux l'IA construit les premières étapes.
3. Clique **Continuer**. La plateforme crée le workflow et ouvre le chat IA à droite pour affiner par conversation.

### Éditeur visuel manuel

1. Crée un nouveau workflow comme ci-dessus mais laisse la description vide.
2. Utilise le bouton **Ajouter une étape** sur le canevas pour ajouter les étapes une à une.
3. Configure chaque étape via le panneau latéral qui apparaît au clic.
4. Relie les étapes en cliquant les poignées et en traçant des liens.

### Par fichier, avec assistance IA

Tu peux créer des workflows en ajoutant des fichiers JSON dans le répertoire `workflows/` de ton projet. Si tu ouvres le projet dans un éditeur IA, il connaît les schémas, types d'étapes et configuration de triggers. Décris ce que doit faire le workflow, l'IA génère une configuration valide. Voir [AI-assisted development](/fr/develop/ai-assisted-development).

## Types d'étapes

| Type      | Couleur | Ce qu'elle fait                                                                                          |
| --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Start     | Bleu    | point d'entrée. Définit le schéma d'entrée et quand il démarre (calendrier, événement, webhook, manuel). |
| Action    | Orange  | exécute une opération — créer un enregistrement, envoyer un message, appeler une API, mettre à jour.     |
| LLM       | Violet  | envoie un prompt à un modèle et passe la réponse à l'étape suivante.                                     |
| Condition | Ambre   | vérifie une condition et route selon des branches.                                                       |
| Loop      | Cyan    | répète un groupe d'étapes pour chaque élément d'une liste.                                               |
| Output    | Vert    | définit le mapping de sortie — ce qui est renvoyé à la fin.                                              |

## Triggers

Chaque workflow a besoin d'au moins un trigger pour savoir quand tourner.

### Triggers calendrier

Lance le workflow selon un calendrier. Tu peux entrer une expression cron directement ou utiliser l'assistant IA pour la générer depuis l'anglais ("every weekday at 9am").

Tous les calendriers tournent en UTC. Presets rapides : toutes les 5 min, horaire, journalier, hebdo, mensuel.

### Triggers événement

Lance le workflow quand quelque chose se passe dans la plateforme — ajout d'un client, ouverture d'une conversation, stock à zéro. Chaque type d'événement peut avoir des conditions de filtre.

### Triggers webhook

Chaque workflow a une URL webhook unique. Un POST HTTP avec un body JSON démarre le workflow avec ces données en entrée. Tu peux ajouter un secret pour vérifier l'authenticité.

## Configuration du workflow

Onglet Configuration :

- Active : activer/désactiver. Les drafts ne peuvent être activées qu'après publication.
- Timeout : durée maximale en millisecondes. Défaut : 300 000 ms (5 min).
- Max retries : combien de fois une étape qui échoue est retentée. Défaut : 3.
- Backoff : délai en ms entre tentatives. Défaut : 1 000 ms.
- Variables : objet JSON clé-valeur partagé par toutes les étapes.

## Tester un workflow

Utilise le panneau Test dans l'éditeur pour :

- Exécuter : lance un run réel avec des données de test. Résultat dans l'onglet Exécutions.

## Historique d'exécution

L'onglet Exécutions de chaque workflow liste tous les runs passés avec date, durée, statut, entrée et sortie de chaque étape.

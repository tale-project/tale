---
title: Construire ton premier agent
description: Mène un projet neuf de « je veux un agent » à un résultat de tâche relu — crée un agent de projet avec un harness, un modèle et un paragraphe d’instructions, confie-lui une vraie tâche et relis ce qui revient.
---

Un premier agent est la plus petite chose utile dans Tale : un nom, un harness, un modèle et un paragraphe d’instructions dans l’onglet **Agents** d’un projet. Ce parcours en crée un, lui confie une vraie tâche et relit le résultat là où le travail de chaque agent attend — la colonne **En revue**. La forme se généralise : chaque agent que tu construis plus tard, ce sont les mêmes quatre gestes avec d’autres choix, et la boucle de la fin est celle où tu passes le plus de temps.

Il te faut le droit de modifier un projet et au moins un fournisseur sous **Paramètres > Fournisseurs IA** avec un modèle dessus. Le côté conceptuel vit dans [Concepts d’agent](/fr/platform/agents/concepts) et la référence champ par champ dans [Agents de projet](/fr/platform/projects/project-agents) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Tu peux modifier le projet — quiconque peut le modifier crée, modifie et supprime ses agents, jusqu’à 50 par projet. L’organisation a un fournisseur configuré avec au moins un modèle ; sans cela, il n’y a rien à choisir sous **Modèle**, et l’exécution de la fin n’a rien à appeler. Et tu as en tête un travail assez étroit pour qu’un paragraphe d’instructions l’encadre — ce parcours prend « résume un message de contact entrant en une phrase plus une action suivante recommandée ».

## Étape 1 — Nommer l’agent et choisir son moteur

Ouvre l’onglet **Agents** du projet. Il liste l’équipe du projet, une ligne par agent, et c’est ici qu’atterrit l’agent que tu vas créer.

<Frame caption="L’onglet Agents — chaque ligne nomme le harness, le fournisseur et le modèle de l’agent.">

![L’onglet Agents du projet Website relaunch listant deux agents nommés — Content editor sur Claude Code et Redirect auditor sur Codex — chaque ligne nommant le fournisseur et l’identifiant du modèle, à côté du bouton Nouvel agent.](/images/platform/project-agents-models.webp)

</Frame>

Clique sur **Nouvel agent**. Les trois premiers champs décident de ce qui tourne :

- **Nom** — `Triage assistant`. Ton équipe le voit sur les cartes de tâches, alors nomme-le d’après le travail.
- **Harness** — la CLI de code sur laquelle l’agent tourne. [Harnesses](/fr/platform/agents/harnesses) les compare et dit quels accès chacun accepte.
- **Modèle** — la liste se filtre à la saisie, et un modèle servi par plusieurs fournisseurs apparaît une fois par fournisseur. Le choix est exact : les exécutions appellent ce modèle via ce fournisseur, et la dépense atterrit sur son accès.

## Étape 2 — Laisser l’équipement vide

**Skills, connectors & outils** décident de ce que l’agent atteint au-delà de sa sandbox : les skills fournissent des bundles de référence, les connectors relaient un service connecté, et les outils de la plateforme lui laissent lire — ou, quand tu accordes un outil d’écriture, changer — les tâches, les documents et les connaissances du projet. Pour le tri, n’accorde rien : l’agent lit une entrée et écrit une sortie, et chaque outil accordé élargit la frontière de confiance. Laisse aussi **Secrets** vide — c’est l’échappatoire pour un service sans connector, et cet agent n’en appelle aucun.

Si l’agent doit plus tard écrire l’action recommandée dans un CRM, tu l’équiperas alors du connector correspondant — mais pas avant que la version texte seul fonctionne.

## Étape 3 — Écrire les instructions et créer l’agent

Les **Instructions** accompagnent chaque exécution comme consigne permanente — ce que l’agent prend en charge, comment il travaille et où il s’arrête. C’est le champ que la plupart des gens surchargent ; garde-le sous un paragraphe :

```text
You read a contact message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.
```

Clique sur **Créer l'agent**. La ligne affiche le harness, le fournisseur, le modèle et le nombre d’équipements — il n’y a pas d’étape de publication, et l’agent peut recevoir du travail dès cet instant.

## Étape 4 — Lui confier une tâche et relire le résultat

Crée une tâche sur le tableau du projet, colle un vrai message de contact dans sa description et choisis un **Relecteur** dans la fiche de la tâche — sans lui, la demande de revue arrive à qui a créé la tâche. Assigne la tâche à `Triage assistant` et clique sur **Démarrer l'agent**. La carte passe en _En cours_ pendant que l’agent travaille dans sa sandbox ; quand il a fini, son rapport arrive en commentaire de la tâche et la carte se gare en **En revue** — un agent ne passe jamais une carte en _Terminé_.

Lis le commentaire : il doit contenir deux lignes selon les instructions, un résumé en une phrase et une action recommandée. Déplace la carte vers _Terminé_ pour l’accepter. Si le format a dérivé, @-mentionne l’agent dans un commentaire de la tâche avec la correction — une exécution de reprise poursuit la même conversation et gare le résultat de nouveau en _En revue_ — et resserre les **Instructions** de l’agent pour la prochaine fois ; les modifications s’appliquent à partir de l’exécution suivante.

## Où cela se place

Quatre gestes, un agent, un résultat relu : la même forme que suit chaque agent que tu construiras plus tard. [Automatisation des tâches](/fr/platform/projects/task-automation) est la boucle du tableau que tu viens de parcourir, de bout en bout — la séparation pilote/relecteur, les mentions, les reprises et le coupe-circuit. [Agents de projet](/fr/platform/projects/project-agents) est la référence pour chaque champ que tu as touché, et [Concepts d’agent](/fr/platform/agents/concepts) le modèle derrière.

Les réglages qui vivaient dans un éditeur d’agent sont ailleurs dans cette version : les connaissances appartiennent à toute l’organisation sous la [Base de connaissances](/fr/platform/knowledge/overview) et se lisent par les outils de la plateforme ([Agents de projet](/fr/platform/projects/project-agents) explique comment), et le travail qui doit tourner sans personne est une [automatisation](/fr/platform/automations/concepts), pas un second agent.

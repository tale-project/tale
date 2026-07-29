---
title: Construire ton premier agent
description: Mène une organisation neuve de « je veux un agent » à une réponse de chat qui fonctionne, en tournant les quatre boutons — instructions, savoir, tools, modèle — dans l'ordre sur une seule instance.
---

Un premier agent est la plus petite chose utile dans Tale : des instructions plus un modèle, parfois avec un tool ou un document lié. Ce parcours tourne les quatre boutons dans l'ordre — instructions, savoir, tools, modèle — et te laisse avec un agent publié qui répond à une vraie question dans un chat. La forme se généralise : chaque agent que tu construis plus tard est les mêmes quatre gestes avec d'autres choix.

Il te faut un rôle Éditeur et un modèle marqué Chat configuré chez le fournisseur de l'organisation. Le côté conceptuel vit dans [Concepts des agents](/fr/platform/agents/concepts) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Ton rôle est au moins Éditeur — l'édition d'agent est verrouillée à Éditeur et au-dessus. L'organisation a un fournisseur configuré et au moins un modèle marqué Chat dessus ; sans cela, la réponse de test à la fin échoue sur l'appel au modèle. Tu as une question en tête à laquelle l'agent doit répondre — choisis quelque chose d'assez étroit pour qu'un paragraphe d'instructions puisse l'encadrer, comme « résume un message d'un contact entrant en une phrase plus une action suivante recommandée ».

## Étape 1 — Écrire les instructions

Les instructions sont le system prompt — la prose qui encadre chaque réponse. Le premier bouton est celui que la plupart des gens forcent trop. Ouvre **Agents > Nouvel agent** et règle :

- **Nom** — `Triage assistant`
- **Instructions** — `You read a customer message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.`

Enregistre comme brouillon pour l'instant ; la publication vient après les autres boutons. Des instructions courtes, tranchées et concrètes battent les longues — garde les règles sous un paragraphe.

## Étape 2 — Décider du savoir

Le savoir est ce que l'agent peut référencer au moment de la réponse. Pour ce premier agent, laisse Savoir vide : le travail est de lire le message, pas de récupérer quoi que ce soit. L'onglet Savoir reste intact.

Si tu voulais ajouter du savoir plus tard — disons une matrice d'escalade que l'agent doit consulter — tu chargerais le document, ouvrirais l'onglet **Savoir** de l'agent et le lierais. Le mécanisme complet vit dans [Agent avec savoir](/fr/tutorials/editor/agent-with-knowledge).

## Étape 3 — Choisir les tools

Les tools sont ce que l'agent peut faire au-delà de répondre en texte. Pour le triage, aucun tool n'est nécessaire : l'agent lit l'entrée et écrit la sortie. Ouvre l'onglet **Tools** et laisse chaque interrupteur désactivé. Chaque tool que tu accordes élargit la frontière de confiance ; garde la liste courte.

Si l'agent doit écrire l'action recommandée dans un CRM, tu activerais plus tard le tool de connector correspondant — mais pas avant que la version texte seul fonctionne.

## Étape 4 — Choisir le modèle et publier

Ouvre l'onglet **Modèle** et choisis le défaut de l'organisation comme primaire ; règle un modèle plus petit en fallback pour que l'agent tourne encore quand le primaire est rate-limited. Enregistre, puis clique **Publier**. L'agent est désormais visible dans le chat pour toute personne avec le bon rôle.

Ouvre un chat avec `Triage assistant` et colle un vrai message d'un contact. La réponse doit atterrir en deux lignes selon les instructions — un résumé en une phrase et une action recommandée. Si le format dérive, resserre les instructions et republie ; c'est la boucle dans laquelle tu passes le plus de temps.

## Où ça s'utilise

Quatre boutons, un agent publié, une réponse vérifiée : la même forme que suit chaque agent que tu construiras plus tard. Les parcours suivants se spécialisent sur un bouton chacun — [Agent avec savoir](/fr/tutorials/editor/agent-with-knowledge) sur le deuxième, [Confier du travail à un worker](/fr/tutorials/editor/delegate-between-agents) sur le troisième.

Pour la page de concept qui nomme les quatre boutons et les arbitrages entre eux, voir [Concepts des agents](/fr/platform/agents/concepts). Pour la version et le rollback une fois que l'agent mûrit, voir [Versions d'agent](/fr/platform/agents/versions).

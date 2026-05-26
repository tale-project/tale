---
title: Déléguer entre agents
description: Câble un agent routeur qui transmet à un agent spécialiste via le tool sub-agents, puis observe la chaîne se dérouler de bout en bout dans un seul chat.
---

La délégation est la forme vers laquelle tu te tournes quand un agent est le mauvais périmètre pour toute la tâche mais le bon pour une étape. Un agent routeur lit la requête, choisit un spécialiste, l'appelle via le tool sub-agents et consolide la réponse. Ce parcours construit une chaîne à deux agents — routeur plus spécialiste billing — sur une instance neuve.

Il te faut un rôle Éditeur et un modèle avec le support tool-calling chez le fournisseur primaire. Le côté conceptuel vit dans [Délégation d'agent](/fr/platform/agents/delegation) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Ton rôle est au moins Éditeur — l'édition d'agent est verrouillée à Éditeur et au-dessus. L'organisation a au moins un modèle marqué Chat avec tool-calling activé ; sans cela, le routeur ne peut pas émettre d'appel de tool. Le budget de timeout d'exécution des agents que tu crées reste sur le défaut (quelques minutes) ; des timeouts courts coupent la chaîne avant que le sub-agent ne réponde.

## Étape 1 — Créer d'abord le spécialiste

Le spécialiste existe avant le routeur car le routeur doit pointer sur un ID qui se résout. Ouvre **Agents > Nouvel agent** et remplis :

- **Nom** — `Billing specialist`
- **Instructions** — `You answer billing questions concisely. State the customer ID you are answering for in the first sentence. If the question is not about billing, refuse and ask the router to re-route.`
- **Tools** — tout désactivé pour ce parcours
- **Modèle** — le défaut de l'organisation

Enregistre et publie. Copie l'ID de l'agent depuis l'URL ou l'en-tête de l'agent — le routeur en a besoin à l'étape suivante.

## Étape 2 — Créer le routeur avec le tool sub-agents

Le routeur est l'agent avec qui l'utilisateur discute réellement. Ouvre à nouveau **Agents > Nouvel agent** et configure :

- **Nom** — `Support router`
- **Instructions** — `You triage incoming questions. For billing questions, delegate to the Billing specialist and frame their reply in one sentence. For anything else, refuse and explain why.`
- **Tools** — active **Sub-agents** ; choisis `Billing specialist` dans le menu
- **Modèle** — le défaut de l'organisation

Enregistre et publie. La liste de tools du routeur contient désormais un sub-agent : le spécialiste de l'Étape 1.

## Étape 3 — Lancer une délégation dans le chat

Ouvre un chat avec `Support router` et demande `My last invoice has a duplicate charge — what should I do?`. La réponse s'affiche en trois morceaux : une carte de tool-call `sub_agent` montrant l'appel du routeur au spécialiste, la réponse du spécialiste dans cette carte, et la phrase de cadrage du routeur en dessous. Déplie la carte pour voir le prompt envoyé par le routeur et la réponse retournée par le spécialiste.

Si le routeur refuse ou répond lui-même au lieu de déléguer, les instructions ne le poussent pas assez — ajoute une règle explicite (`Always delegate billing questions; do not answer them yourself.`) et republie.

## Étape 4 — Inspecter l'exécution

Ouvre **Automatisations > Executions** (ou l'onglet **History** du chat, selon le nom que l'organisation donne à la surface) et trouve le chat que tu viens de lancer. L'exécution liste le run parent et le run du sub-agent en lignes imbriquées : qui a déclenché, ce que chaque agent a reçu, ce que chacun a émis, et combien de temps chacun a pris. C'est la piste d'audit que tu montres quand un client demande « qu'a réellement dit l'agent ».

## Où ça s'utilise

Une chaîne routeur-plus-spécialiste est la plus petite délégation utile : une décision de routage, un spécialiste, une réponse consolidée. La même forme passe à l'échelle — ajoute un spécialiste technique à côté du billing, attache un troisième palier pour les escalades, remplace le routeur par un workflow quand les étapes deviennent fixes.

Pour l'arbitrage entre délégation et workflow avec approbations, voir [Délégation d'agent](/fr/platform/agents/delegation). Pour le modèle à quatre boutons derrière chaque agent, voir [Concepts des agents](/fr/platform/agents/concepts).

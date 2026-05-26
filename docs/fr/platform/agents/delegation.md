---
title: Délégation d'agent
description: Un agent peut en appeler un autre via l'outil sous-agent. Cette page donne le modèle mental pour quand déléguer, comment les délais propagent et ce qui empêche une chaîne de boucler.
---

La délégation est le mouvement que tu fais quand un agent est la mauvaise forme pour tout le travail, mais la bonne forme pour une étape. L'agent routeur lit la requête, décide à quel spécialiste passer la main, l'appelle via l'outil sous-agent et consolide la réponse. Le motif fonctionne pour le tri, le routage et tout cas où la bonne voix dépend de la question.

Cette page te donne le modèle mental pour quand déléguer et comment maintenir la chaîne bornée. Lis-la avant de câbler ton premier workflow multi-agents ; reviens-y quand une chaîne de délégation cesse de revenir et que tu dois savoir quelle limite a tiré.

## Comment fonctionne la délégation

La liste d'outils d'un agent routeur inclut l'outil **sous-agents**. Quand le routeur l'appelle avec l'ID du spécialiste et un prompt, Tale démarre une conversation enfant : le spécialiste ne voit que le prompt envoyé par le routeur (pas tout l'historique du routeur), tourne jusqu'au bout et retourne sa réponse finale. Le routeur lit la réponse comme résultat d'outil et continue — typiquement il consolide en une seule réponse sortante.

La conversation enfant tourne contre les quatre boutons propres du spécialiste : ses instructions, ses connaissances, ses outils, son modèle. Le routeur n'hérite d'aucun ; le spécialiste ne voit aucun de ceux du routeur. Ils partagent une organisation et un budget, rien d'autre.

## Délais et propagation de budget

Deux limites empêchent une chaîne de tourner sans fin :

- **Délai d'exécution** — fixé par agent en minutes. Quand le délai tire, l'appel d'outil en cours renvoie une erreur et l'agent se déroule. Les appels de sous-agents tournent dans le délai restant du parent ; un sous-agent ne peut pas prolonger le budget de son parent.
- **Budget de tokens** — appliqué au niveau de l'organisation ou de l'équipe par politique de gouvernance. La dépense en tokens remonte : les tokens d'un sous-agent comptent contre l'exécution de l'agent parent, qui compte contre la règle de budget de l'organisation.

Si une chaîne de délégation atteint une règle de budget en plein appel, la réponse du sous-agent en vol revient quand même ; l'appel d'outil suivant du parent est bloqué. Le log d'exécution enregistre le coup au budget.

## Exemple — une chaîne routeur → spécialiste

Un agent routeur de support client a une instruction courte et trois outils : sous-agent pour un spécialiste facturation, sous-agent pour un spécialiste technique, RAG sur la FAQ support. Sur un message entrant :

1. Le routeur décide entre facturation, technique ou « je réponds moi-même depuis la FAQ ».
2. Si facturation : il appelle le spécialiste facturation avec la question du client et l'ID client. Le spécialiste a des outils pour interroger le système de facturation ; il retourne un brouillon de réponse.
3. Le routeur lit le brouillon, ajoute un paragraphe d'encadrement et répond.
4. Le log d'exécution montre l'agent parent, l'appel au spécialiste et la récupération FAQ (ou son absence) pour la piste d'audit.

## Quand y recourir

| Utilise … quand                                                  | Délégation | Agent unique | Workflow |
| ---------------------------------------------------------------- | ---------- | ------------ | -------- |
| La voix ou les connaissances dépendent du domaine de la question | ✓          |              |          |
| Un agent peut couvrir tout le travail                            |            | ✓            |          |
| Le travail a des étapes explicites avec approbations entre elles |            |              | ✓        |
| La chaîne a plus de trois sauts                                  |            |              | ✓        |

La délégation est la bonne forme quand la décision de routage est elle-même un travail pour un agent. Un workflow est la bonne forme quand les étapes sont fixes et que tu veux des approbations ou de la planification entre.

## Construis-en une

Le coût de la délégation est un appel supplémentaire par passage de main ; le bénéfice est la bonne connaissance et la bonne voix à chaque étape sans qu'un agent ait à tout savoir. Garde les chaînes courtes (deux ou trois agents) ; pour plus long, une automatisation te donne la piste d'audit et les coutures d'approbation que la délégation n'a pas. La marche suivante naturelle est [Déléguer entre agents](/fr/tutorials/editor/delegate-between-agents) — elle construit une chaîne routeur → spécialiste de bout en bout.

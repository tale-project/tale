---
title: Outils d'agent
description: Les familles d'outils intégrées qu'un agent peut utiliser au-delà de la génération de texte, comment l'agent choisit lesquels appeler, et comment les appels d'outils s'affichent dans la réponse.
---

Les outils sont ce qu'un agent peut faire au-delà de produire du texte. Le modèle décide quel outil appeler depuis une liste que l'auteur de l'agent a activée ; Tale exécute l'outil, retourne le résultat, et le modèle continue. Cette page liste les familles d'outils intégrées et les règles autour de leur apparition dans une réponse.

Le catalogue complet vit dans l'onglet **Tools** de l'agent — active un outil et l'agent peut l'appeler ; désactive-le et l'agent oublie son existence. Le but de cette page est la forme et le modèle de confiance, pas un tour exhaustif drapeau par drapeau.

## Un appel d'outil déroulé

L'utilisateur demande « quel temps fait-il à Zurich aujourd'hui ». L'agent a l'outil web activé. Le modèle émet un appel d'outil contre l'outil web avec la requête « météo Zurich aujourd'hui » ; Tale récupère le résultat et le retourne au modèle ; le modèle écrit la réponse avec le résultat et cite la source. Du côté de l'utilisateur, le chat affiche un appel d'outil plié « Fetching web content » entre le message de l'utilisateur et la réponse.

## Familles d'outils intégrées

- **Web** — récupère et lit les URL que le modèle juge utiles.
- **Fichiers** — lit les pièces jointes et fichiers du Projet actif.
- **RAG** — cherche dans les sources de connaissances liées à l'agent et retourne des chunks avec citations. Nomme un dossier dans ta demande (« cherche seulement dans Contracts/2024 ») et l'agent limite la recherche à ce dossier et à ses sous-dossiers.
- **Run code** — exécute Python, Node ou des scripts shell dans une sandbox. Gouverné par la [politique run-code](/fr/platform/admin/governance/run-code-policy) de l'organisation.
- **Sous-agents** — délègue à un autre agent que l'organisation a marqué appelable comme sous-agent. La prévention des boucles vit sur [Délégation](/fr/platform/agents/delegation).
- **Workflows** — invoque un workflow Tale comme un outil. Les sorties du workflow reviennent comme résultat d'outil.
- **MCP** — appelle des outils exposés par les [serveurs MCP](/fr/platform/integrations/mcp-servers) enregistrés.
- **Intégrations** — appelle une intégration tierce que l'organisation a connectée.
- **Entrée humaine** — met l'agent en pause et pose une question à l'utilisateur (ou à un pool d'approbateurs) ; la réponse devient le résultat d'outil.
- **Update todos** — entretient la liste de todos de l'agent dans un [plan de recherche](/fr/platform/agents/concepts).

## Ajouter des outils à un agent

Ouvre l'onglet **Tools** de l'agent. Chaque famille est une bascule ; certaines exposent des sous-bascules (quelle intégration, quel serveur MCP). Activer une famille ajoute ses outils à la liste d'outils du modèle au moment de la requête. Il n'y a pas de réglage fin par outil au-delà de la bascule — les agents sont prévus pour être configurés au niveau de la famille.

## Streaming des appels d'outils

Les appels d'outils s'affichent dans le chat comme des cartes pliées entre le message de l'utilisateur et la réponse. Déplier une carte révèle le nom de l'outil, les entrées que le modèle a émises, et le résultat que Tale a retourné. Un appel d'outil échoué montre l'erreur et laisse l'utilisateur voir ce que l'agent a tenté ; le modèle retente d'habitude avec une autre forme au tour suivant.

## Où ça s'inscrit

Les outils élargissent ce qu'un agent peut faire ; ils élargissent aussi la frontière de confiance, puisque l'agent peut désormais lire, écrire ou appeler des choses pour le compte de l'utilisateur. Couple cette page avec [Politique run-code](/fr/platform/admin/governance/run-code-policy) si l'agent va exécuter du code, et avec [Serveurs MCP](/fr/platform/integrations/mcp-servers) s'il va tendre la main via MCP. Les instructions de l'agent restent l'endroit où vit la **politique** ; l'onglet **Tools** est l'endroit où vit la **surface**.

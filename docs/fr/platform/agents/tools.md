---
title: Outils d’agent
description: Les permissions outil par outil qu’un agent porte au-delà de la génération de texte — les catégories d’outils, les modes de recherche web, et les intégrations et workflows liés.
---

Les outils sont ce qu’un agent peut faire au-delà de produire du texte. Le modèle choisit quel outil appeler dans la liste que l’auteur de l’agent a accordée ; Tale exécute l’outil, rend le résultat, et le modèle continue. L’onglet **Outils** de l’agent est cette liste — un catalogue interrogeable d’interrupteurs par outil, groupés en cartes de catégorie.

<Frame caption="Le catalogue d’outils — une carte par catégorie, chacune comptant combien de ses outils l’agent a reçus.">

![L’onglet Outils de l’éditeur d’agent, défilé jusqu’aux cartes de catégorie, avec Connaissances à trois outils cochés sur quatre et Fichiers à sept sur sept, tandis que Conversations, Discussions, Analytique et Tâches et projets n’ont rien d’accordé.](/images/platform/agent-editor-tools.webp)

</Frame>

## Accorder les outils un par un

Coche un outil et l’agent peut l’appeler dès la prochaine requête ; décoche-le et l’agent oublie qu’il existe. **Rechercher des outils…** filtre le catalogue par nom ou par catégorie, chaque ligne d’outil porte une description d’une ligne de ce qu’elle accorde, et la case d’en-tête d’une catégorie active tout le groupe d’un coup — le compteur à côté montre combien d’outils du groupe sont actifs. Les catégories reflètent les surfaces de la plateforme : **Contacts**, **Produits**, **Fournisseurs** et **Sites web** exposent des outils de lecture et de mise à jour sur des enregistrements structurés ; **Conversations** et **Discussions** laissent l’agent lire et répondre ; **Connaissances** couvre la recherche et l’écriture de documents ; **Tâches et projets** inclut la propre liste de tâches de l’agent ; **Workflows** lui permet de créer et lancer des workflows ; **Fichiers** couvre les opérations de l’agent sur les fichiers ; **Système** contient **Exécuter du code**, **Demander à un humain** et les autres outils d’exécution. Accorde le plus petit ensemble qui fait le travail — chaque outil activé élargit ce que l’agent peut lire ou changer en ton nom.

**Exécuter du code**, dans le groupe **Système**, est le plus large de ces outils : il exécute du Python, du Node ou du bash dans la sandbox propre au chat, et travaille sur les fichiers que le chat tient déjà plutôt que dans une boîte vide. Un appel lance un extrait de code directement, lance un script que l’agent a déposé sous `/user/code/`, ou installe seulement des paquets — les paquets déclarés s’installent d’abord et persistent le reste du tour, et ce que l’exécution écrit sous `/user/output/` réapparaît comme fichier dans le chat. Les fichiers et dossiers que tu épingles avec `@` arrivent dans cette sandbox sous `/user/uploads/`, si bien que le code ouvre les vrais octets plutôt qu’un extrait de récupération.

<Note>

Un agent lance de lui-même un **worker** ciblé pour une sous-tâche — ce n’est pas un outil que tu actives ici. [Workers d’agent](/fr/platform/agents/delegation) couvre quand c’est le bon mouvement et comment un worker hérite d’un sous-ensemble borné des capacités de l’agent.

</Note>

## Configurer la recherche web

**Recherche web** en haut de l’onglet est un mode, pas une case : **Désactivé**, **Outil** (l’agent cherche à la demande), **Contexte** (les résultats web pertinents sont injectés dans chaque réponse) ou **Les deux**. La recherche web ne parcourt que le contenu des sites web ajoutés à ton organisation — ce n’est pas un crawl ouvert ; gère les sources sous [Sites web](/fr/platform/knowledge/crawling).

## Lier des intégrations et des workflows

Sous le catalogue, **Intégrations liées** et **Flux de travail liés** attachent des intégrations ou des workflows précis comme outils dédiés, pour que l’agent les appelle sans nommer lui-même l’intégration ou l’identifiant du workflow. Lie ceux dont le travail de l’agent dépend ; les [serveurs MCP](/fr/platform/integrations/mcp-servers) connectés atteignent l’agent par le même chemin, à travers les intégrations de l’organisation.

## Comment les appels d’outil s’affichent

Les appels d’outil apparaissent dans le chat comme des cartes repliées entre le message de l’utilisateur et la réponse. Déplier une carte révèle le nom de l’outil, les entrées émises par le modèle et le résultat rendu par Tale. Un appel d’outil échoué montre l’erreur ; le modèle réessaie en général avec une autre forme au tour suivant.

## Quand y recourir

| Utilise les outils quand…                                               | Utilise les connaissances quand…                   |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| L’agent doit agir — interroger, mettre à jour, exécuter, répondre       | L’agent doit citer les documents qu’il a récupérés |
| Les données sont des enregistrements structurés ou des systèmes vivants | Les données sont du contenu téléversé ou crawlé    |

## Où ça se situe

Les outils élargissent ce qu’un agent peut faire ; ils élargissent aussi la frontière de confiance, puisque l’agent peut désormais lire, écrire ou appeler des choses au nom de l’utilisateur. Couple cette page avec la [politique run-code](/fr/platform/admin/governance/run-code-policy) si l’agent exécutera du code. Les instructions de l’agent restent l’endroit où vit la **politique** ; l’onglet **Outils** est l’endroit où vit la **surface**.

---
title: Harnesses
description: Des CLI de code qui exécutent un modèle dans une sandbox isolée — quels harnesses sont livrés, où tu en choisis un, d’où vient l’accès, et ce que la boîte peut atteindre.
---

Un **Harness** est une CLI de code livrée avec la plateforme — Claude Code, Codex, Cursor et les autres — qui exécute le modèle choisi dans un conteneur isolé, au lieu de la boucle de chat ordinaire. Le harness planifie, écrit des fichiers, lance des commandes, installe des paquets et rend compte. Tu ne choisis jamais un harness dans le composer du chat : le chat ne sélectionne qu’un **modèle**. Le harness se choisit quand tu crées un **agent de projet** ou un nœud **agent** d’automatisation — les deux surfaces nomment le champ **Harness**.

Cette page traite des harnesses livrés avec Tale, de l’endroit où tu en choisis un, de l’origine de l’accès, et de ce que le conteneur peut ou ne peut pas atteindre. Les accès eux-mêmes relèvent de l’organisation — voir [Fournisseurs](/fr/platform/admin/providers). **Paramètres > Fournisseurs IA** porte aussi une section **Harnesses** qui montre comment chaque harness se résoudrait pour l’organisation.

## Où tu choisis un harness

Ouvre l’onglet **Agents** d’un projet et crée ou modifie un agent. Le dialogue demande un **Harness** — la CLI de code sur laquelle cet agent tournera — à côté de son modèle, de son équipement et de ses instructions. Assigne une tâche du tableau à cet agent et il travaille dans une sandbox sur ce harness.

Dans une automatisation, un nœud **agent** porte le même champ **Harness**. Quand le workflow atteint ce nœud, le tour s’exécute sur le harness choisi.

Le chat ne liste aucun harness. Le sélecteur du composer ne propose que des modèles ; le travail sur harness arrive par un agent de projet ou un nœud agent d’automatisation, pas par un groupe du composer.

## Ce qu’est un tour sur harness

Décris la tâche en langage ordinaire : « écris une petite CLI Python et teste-la », « clone ce dépôt et corrige le bug de l’issue 42 ». Le message part vers le harness, pas directement vers le modèle. Le harness pilote le modèle en boucle à l’intérieur du conteneur et décide lui-même quand lire un fichier, lancer une commande ou refaire un essai ; son rapport arrive quand le tour se termine — en commentaire sur la tâche d’un agent de projet, en sortie de l’étape dans une automatisation.

Deux conséquences. Le travail est réel plutôt que décrit : les fichiers existent, les commandes ont bel et bien tourné, et c’est leur sortie que le modèle a analysée. Et le rythme du tour appartient au harness, pas à Tale — il décide quand le travail est fait et termine le tour, et Tale collecte ce qu’il a produit.

## Les harnesses livrés

Neuf harnesses sont livrés avec la plateforme. Ils diffèrent par la façon dont ils reçoivent un prompt, par la possibilité de les infléchir en cours de tour, et par leur prise du canal MCP — les serveurs que Tale monte dans la sandbox, sur un accès géré, pour tendre à un tour ses connectors connectés et un navigateur ; aucun serveur MCP externe n’entre en jeu.

| Harness     | Accès acceptés     | Bon à savoir                                                                                                                                 |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Géré ou le tien    | Le plus capable : infléchissable en cours de tour — un commentaire de tâche l’atteint pendant que le travail est encore en cours. Prend le canal MCP. |
| Codex       | Géré ou le tien    | Tours en un seul passage. Prend le canal MCP.                                                                                         |
| Cursor      | Le tien uniquement | Tours en un seul passage. Sa CLI ne sait pas passer par la passerelle de la plateforme, un accès géré est donc refusé.                       |
| Gemini CLI  | Géré ou le tien    | Tours en un seul passage. Prend le canal MCP.                                                                                         |
| Hermes      | Géré ou le tien    | Tours en un seul passage, sans canal MCP.                                                                                                    |
| OpenClaw    | Géré ou le tien    | Tours en un seul passage. Prend le canal MCP.                                                                                         |
| OpenCode    | Géré uniquement    | Tours en un seul passage. Prend le canal MCP. Passe par la passerelle, ta propre clé est refusée.                                     |
| Pi          | Géré ou le tien    | Tours en un seul passage, sans canal MCP.                                                                                                    |
| Qwen Code   | Géré ou le tien    | Tours en un seul passage. Prend le canal MCP.                                                                                         |

En pratique, la différence se joue sur l’inflexion. Tu infléchis une exécution en cours en commentant la tâche et en @mentionnant l’agent. Avec Claude Code, le commentaire atteint l’agent à sa prochaine frontière d’outil : « prends pnpm, pas npm » arrive donc pendant que le travail est encore en cours. Tous les autres harnesses n’acceptent plus rien une fois lancés : Tale arrête alors le processus en cours et poursuit la même conversation sur un processus neuf, ton commentaire en main.

## D’où vient l’accès

L’accès appartient à l’organisation, pas à l’agent. Un agent ne détient aucune clé propre, et il n’existe pas d’onglet d’accès par agent ; ce avec quoi un tour s’authentifie découle de l’accès fournisseur associé au modèle que tu as choisi, configuré sous [Fournisseurs](/fr/platform/admin/providers). Laquelle des deux postures un tour adopte découle du type d’accès dont il s’agit.

**Une clé d’API stockée, ou lue dans une variable d’environnement du déploiement**, reste chez la plateforme. Tale frappe pour le tour une clé de passerelle limitée à la session, et le harness s’authentifie avec elle plutôt qu’avec le vrai secret : le conteneur ne détient donc jamais un accès qui survive à la session. C’est la posture gérée, et le seul harness qui la refuse est Cursor.

**Un abonnement fournisseur** — clé de plan de code, clé de portail, blob OAuth, ou pool de jetons rotatifs récupérés auprès d’un broker — fonctionne autrement, parce que les fournisseurs réservent ces accès à leur propre outillage d’agent. Un accès par abonnement force donc le tour sur un harness précis : demander un tour de chat ordinaire est refusé avec un motif qui nomme ce harness, et demander un autre harness l’est aussi. Le secret est injecté dans l’environnement de la session, donc en posture bring-your-own, et le harness imposé doit l’accepter — OpenCode, qui ne passe que par la passerelle, refuse.

<Note>

Un tour sur harness nomme toujours un harness concret. Rien n’en devine un à ta place : le seul cas où un harness arrive de lui-même est l’accès par abonnement, qui porte son choix imposé avec lui.

</Note>

## Ce que la sandbox peut atteindre

Un agent de projet travaille dans un espace de travail permanent, qui persiste d’une tâche à l’autre ; il démarre vide. Les pièces jointes de la tâche sont recopiées en lecture seule sous `/agent/inputs/<task>/attachments/`, de sorte que l’agent ouvre les vrais octets plutôt qu’un extrait de recherche, et ce qu’il écrit dans sa boîte de livraison sous `/agent/output/<task>/` est collecté à la fin du tour et attaché à la tâche comme **Fichiers produits** ; un nœud agent d’automatisation collecte `/agent/output/` comme sortie de l’étape. Le trafic sortant est ouvert par défaut, les cibles dangereuses restant toujours bloquées — le point de métadonnées cloud et les plages d’adresses privées — si bien que l’agent installe des paquets et clone des dépôts sans jamais atteindre le réseau hôte ; un opérateur auto-hébergé peut resserrer l’egress sur une liste d’hôtes au niveau du déploiement.

Les connectors connectées atteignent l’agent par un broker, pas par la boîte. Quand l’agent en appelle une, la requête repart vers Tale, qui l’exécute avec l’accès stocké et ne renvoie que le résultat : un conteneur compromis ne peut donc pas lire tes clés. Le broker ne porte que des actions de lecture : une écriture — poster un message, envoyer un mail, ouvrir un ticket — est refusée avec un motif lisible, si bien qu’un agent ne peut pas modifier un système extérieur depuis sa sandbox ; cette étape revient au nœud connector d’une automatisation. GitHub est l’exception assumée : `git` et la CLI `gh` ont besoin d’un jeton en local ; tant que l’agent a le connecteur GitHub équipé, chaque exécution reçoit un jeton restreint — injecté à chaque exécution, disparu dès sa fin.

Les skills liés à l’agent sont déposés dans la session sous forme de fichiers plutôt que récupérés par un outil, et un skill livré par le dépôt cloné l’emporte sur la copie que Tale déposerait — cette règle de priorité est détaillée dans [Skills d’agent](/fr/platform/agents/skills). Les autres valeurs qu’une exécution reçoit sont les **Secrets** de l’organisation dont l’agent est équipé — une clé API en variable d’environnement, posée à chaque exécution et disparue à sa fin —, et c’est ainsi qu’un jeton pour un service sans connecteur rejoint le travail ; [Agents de projet](/fr/platform/projects/project-agents) les décrit.

## Coût et mesure

Un tour sur harness peut être long et appeler le modèle de nombreuses fois : il coûte donc plus qu’une simple réponse de chat. Les tours gérés passent par la passerelle, et c’est ce qui les rend mesurables : ils atterrissent dans l’[Analytique d’usage](/fr/platform/admin/governance/usage-analytics) au même titre que tous les autres, et les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l’organisation plafonnent ce qu’ils peuvent dépenser.

Les tours sur un accès par abonnement contournent la passerelle par construction, puisque le secret entre dans le conteneur et que l’outillage du fournisseur lui parle directement. Ces tours ne sont pas mesurés et les plafonds de dépense de l’organisation ne les atteignent pas — la comptabilité revient à qui détient l’abonnement.

## Où cela se place

Un harness transforme un agent de projet ou un nœud agent d’automatisation en session vivante avec un outil de code dans un conteneur isolé : tu le diriges en langage ordinaire, il travaille sur de vrais fichiers, et le harness impose le rythme du tour. Le chat reste limité aux modèles ; le champ **Harness** vit sur l’agent ou sur le nœud d’automatisation. Ce qui décide de la part restant sous le contrôle de l’organisation, c’est l’accès — une clé stockée garde le tour sur la passerelle, sous les plafonds et dans la mesure, tandis qu’un abonnement fournisseur le pousse dans la boîte et sur le compte de ce fournisseur. Lis cette page avec [Fournisseurs](/fr/platform/admin/providers) pour le versant accès et [Connectors](/fr/platform/connectors/overview) pour ce que l’agent peut atteindre une fois lancé.

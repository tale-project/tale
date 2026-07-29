---
title: Agents sandbox
description: Des tours qui exécutent un modèle dans un harness d’agent de code isolé — quels harnesses sont livrés, d’où vient l’accès, et ce que la boîte peut atteindre.
---

Un agent sandbox est un tour qui exécute le modèle que tu as choisi dans un harness d’agent de code, au lieu de la boucle de chat ordinaire. Le harness est un agent en ligne de commande qui vit dans un conteneur isolé : il planifie, écrit des fichiers, lance des commandes, installe des paquets et rend compte, et tu lui parles dans la conversation pendant qu’il travaille. Le sélecteur de modèles du composer les range sous **Sandbox agents**, à côté du groupe **Models**.

Cette page traite de ce qu’est un tour en sandbox, des harnesses livrés avec Tale, de l’origine de l’accès, et de ce que le conteneur peut ou ne peut pas atteindre. Les accès eux-mêmes relèvent de l’organisation — voir [Fournisseurs](/fr/platform/admin/providers).

## Ce qu’est un tour en sandbox

Choisis un agent sandbox dans le composer et décris la tâche en langage ordinaire : « écris une petite CLI Python et teste-la », « clone ce dépôt et corrige le bug de l’issue 42 ». Ton message part vers le harness, pas directement vers le modèle. Le harness pilote le modèle en boucle à l’intérieur du conteneur et décide lui-même quand lire un fichier, lancer une commande ou refaire un essai ; la réponse arrive quand son tour se termine.

Deux conséquences. Le travail est réel plutôt que décrit : les fichiers existent, les commandes ont bel et bien tourné, et c’est leur sortie que le modèle a analysée. Et la forme du tour appartient au harness, pas à Tale — un harness doté d’un mode plan termine sur une proposition que tu peux relire, un harness fait pour les passages uniques va simplement au bout.

## Les harnesses livrés

Neuf harnesses sont livrés avec la plateforme. Ils diffèrent par la façon dont ils reçoivent un prompt, par la possibilité de les infléchir en cours de tour, et par leur accès aux serveurs MCP.

| Harness     | Accès acceptés     | Bon à savoir                                                                                                                                 |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Géré ou le tien    | Le plus capable : infléchissable en cours de tour, avec un mode plan qui se termine par une proposition relisible. Atteint les serveurs MCP. |
| Codex       | Géré ou le tien    | Tours en un seul passage. Atteint les serveurs MCP.                                                                                          |
| Cursor      | Le tien uniquement | Tours en un seul passage. Sa CLI ne sait pas passer par la passerelle de la plateforme, un accès géré est donc refusé.                       |
| Gemini CLI  | Géré ou le tien    | Tours en un seul passage. Atteint les serveurs MCP.                                                                                          |
| Hermes      | Géré ou le tien    | Tours en un seul passage, sans canal MCP.                                                                                                    |
| OpenClaw    | Géré ou le tien    | Tours en un seul passage. Atteint les serveurs MCP.                                                                                          |
| OpenCode    | Géré uniquement    | Tours en un seul passage. Atteint les serveurs MCP. Passe par la passerelle, ta propre clé est refusée.                                      |
| Pi          | Géré ou le tien    | Tours en un seul passage, sans canal MCP.                                                                                                    |
| Qwen Code   | Géré ou le tien    | Tours en un seul passage. Atteint les serveurs MCP.                                                                                          |

En pratique, la différence se joue sur l’inflexion. Avec Claude Code, une correction envoyée pendant que le tour tourne atteint l’agent à sa prochaine frontière d’outil : « prends pnpm, pas npm » arrive donc pendant que le travail est encore en cours. Tous les autres harnesses récupèrent un message en attente à la frontière du tour.

## D’où vient l’accès

L’accès appartient à l’organisation, pas à l’agent. Un agent ne détient aucune clé propre, et il n’existe pas d’onglet d’accès par agent ; ce avec quoi un tour s’authentifie découle de l’accès fournisseur associé au modèle que tu as choisi, configuré sous [Fournisseurs](/fr/platform/admin/providers). Laquelle des deux postures un tour adopte découle du type d’accès dont il s’agit.

**Une clé d’API stockée, ou lue dans une variable d’environnement du déploiement**, reste chez la plateforme. Tale frappe pour le tour une clé de passerelle limitée à la session, et le harness s’authentifie avec elle plutôt qu’avec le vrai secret : le conteneur ne détient donc jamais un accès qui survive à la session. C’est la posture gérée, et le seul harness qui la refuse est Cursor.

**Un abonnement fournisseur** — clé de plan de code, clé de portail, blob OAuth, ou pool de jetons rotatifs récupérés auprès d’un broker — fonctionne autrement, parce que les fournisseurs réservent ces accès à leur propre outillage d’agent. Un accès par abonnement force donc le tour en sandbox sur un harness précis : demander un tour de chat ordinaire est refusé avec un motif qui nomme ce harness, et demander un autre harness l’est aussi. Le secret est injecté dans l’environnement de la session, donc en posture bring-your-own, et le harness imposé doit l’accepter — OpenCode, qui ne passe que par la passerelle, refuse.

<Note>

Un tour en sandbox nomme toujours un harness concret. Rien n’en devine un à ta place : le seul cas où un harness arrive de lui-même est l’accès par abonnement, qui porte son choix imposé avec lui.

</Note>

## Ce que la sandbox peut atteindre

Le conteneur démarre sur un répertoire de travail vide et reste verrouillé par défaut. Les fichiers et dossiers que tu épingles avec `@` entrent dans la session sous `/user/uploads/`, de sorte que l’agent ouvre les vrais octets plutôt qu’un extrait de recherche, et ce qu’il écrit sous `/user/output/` revient dans la conversation sous forme de fichier. Le trafic sortant est bloqué hormis une liste étroite — registres de paquets et GitHub — si bien que l’agent peut installer ce dont il a besoin et cloner un dépôt public sans atteindre des hôtes arbitraires.

Les intégrations connectées atteignent l’agent par un broker, pas par la boîte. Quand l’agent en appelle une, la requête repart vers Tale, qui l’exécute avec l’accès stocké et ne renvoie que le résultat : un conteneur compromis ne peut donc pas lire tes clés. Une écriture apparaît comme une carte de validation dans la conversation et se poursuit une fois que tu l’approuves. GitHub est l’exception assumée : `git` et la CLI `gh` ont besoin d’un jeton en local ; un tour s’exécute donc avec un jeton restreint tant que la conversation garde le connecteur GitHub équipé — injecté à chaque tour, disparu dès la fin du tour.

Les skills liés à l’agent sont déposés dans la session sous forme de fichiers plutôt que récupérés par un outil, et un skill livré par le dépôt cloné l’emporte sur la copie que Tale déposerait — cette règle de priorité est détaillée dans [Skills d’agent](/fr/platform/agents/skills). Tes propres [variables d’environnement et secrets](/fr/platform/member/environment) sont également posés dans le conteneur : c’est ainsi qu’un jeton personnel ou un point d’accès à toi rejoint le travail sans qu’aucune autre session le voie.

## Coût et mesure

Un tour en sandbox peut être long et appeler le modèle de nombreuses fois : il coûte donc plus qu’une simple réponse de chat. Les tours gérés passent par la passerelle, et c’est ce qui les rend mesurables : ils atterrissent dans l’[Analytique d’usage](/fr/platform/admin/governance/usage-analytics) au même titre que tous les autres, et les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l’organisation plafonnent ce qu’ils peuvent dépenser.

Les tours sur un accès par abonnement contournent la passerelle par construction, puisque le secret entre dans le conteneur et que l’outillage du fournisseur lui parle directement. Ces tours ne sont pas mesurés et les plafonds de dépense de l’organisation ne les atteignent pas — la comptabilité revient à qui détient l’abonnement.

## Où cela se place

Un agent sandbox transforme une conversation en session vivante avec un outil de code dans un conteneur isolé : tu le diriges en langage ordinaire, il travaille sur de vrais fichiers, et le harness impose le rythme du tour. Ce qui décide de la part restant sous le contrôle de l’organisation, c’est l’accès — une clé stockée garde le tour sur la passerelle, sous les plafonds et dans la mesure, tandis qu’un abonnement fournisseur le pousse dans la boîte et sur le compte de ce fournisseur. Lis cette page avec [Fournisseurs](/fr/platform/admin/providers) pour le versant accès et [Intégrations](/fr/platform/integrations/overview) pour ce que l’agent peut atteindre une fois lancé.

---
title: Serveurs MCP
description: Les serveurs MCP sont des processus externes qui exposent des tools aux agents de Tale via le Model Context Protocol. Les Administrateurs les enregistrent sous Paramètres > Serveurs MCP ; la règle d'approbation par tool décide ce que chaque agent peut appeler.
---

Un serveur MCP est un processus externe qui expose des tools aux agents de Tale via le Model Context Protocol. Là où une intégration premier-party est un connecteur spécifique au fournisseur que Tale ship, un serveur MCP est un pont générique que n'importe qui peut héberger — le protocole est ouvert, le contrat est un ensemble de tools et de ressources, et l'org décide par serveur ce que ses agents peuvent atteindre. Les Administrateurs enregistrent les serveurs MCP sous **Paramètres > Serveurs MCP** ; les Développeurs et Éditeurs pointent les agents dessus.

Cette page est la référence pour ce qu'un serveur MCP apporte dans Tale, comment marche l'enregistrement, comment la règle d'approbation par tool forme ce qu'un agent peut appeler, et en quoi les serveurs MCP diffèrent des intégrations premier-party. Le protocole lui-même est documenté en amont ; ce qui suit est la surface côté Tale.

## Ce qu'apporte un serveur MCP

Un serveur MCP parle le Model Context Protocol par HTTP ou stdio. Une fois enregistré, Tale récupère le manifeste de tools du serveur — une liste de tools nommés, leurs schémas d'entrée et ce que fait chacun — et expose les tools comme famille de tools sur chaque agent auquel le serveur est lié. L'agent appelle le tool de la même façon qu'il appelle n'importe quel autre tool ; la requête voyage à travers Tale jusqu'au serveur MCP, la réponse du serveur revient, et l'agent l'utilise dans la réponse.

Le serveur peut aussi exposer des **ressources** (contexte en lecture seule que l'agent peut tirer) et des **prompts** (templates nommés que l'agent peut composer). Les tools sont la surface la plus courante ; ressources et prompts sont des capacités optionnelles qu'un serveur peut implémenter ou non.

## Enregistrer un serveur

Ouvre **Paramètres > Serveurs MCP** et clique sur **Ajouter un serveur**. Le formulaire demande :

- **Nom** — une étiquette humaine qui apparaît dans la liste de tools de l'agent et sur chaque carte d'approbation.
- **Transport** — HTTP ou stdio. Les serveurs HTTP portent une URL ; les serveurs stdio portent une commande que Tale spawn.
- **Authentification** — aucune, jeton bearer, ou OAuth. Les jetons vont dans un champ secret ; OAuth déroule la danse comme une intégration premier-party.
- **Agents autorisés** — quels agents peuvent se lier à ce serveur. Le défaut est aucun agent ; va vers **Tous les agents** seulement quand le serveur est assez générique pour que chaque agent en bénéficie.

Enregistrer le formulaire déclenche un handshake : Tale se connecte au serveur, récupère le manifeste et le range. Un échec du handshake fait remonter l'erreur amont à côté de la ligne.

## La règle d'approbation par tool

La première fois qu'un agent appelle un tool d'un serveur MCP, Tale fait remonter une carte d'approbation au pool d'approbateurs MCP de l'org (configuré sous **Paramètres > Gouvernance > Approbations MCP**). L'approbateur décide si le tool est autorisé pour cet agent. Trois issues :

- **Approuver une fois** — le tool tourne cette fois, et l'appel suivant fait remonter la carte à nouveau.
- **Approuver pour cet agent** — le tool est autorisé pour cet agent pour toujours ; les appels suivants tournent sans carte.
- **Refuser** — le tool est bloqué pour cet agent ; les appels suivants échouent avec une erreur d'autorisation.

L'approbation par tool est par agent et par tool. Approuver le tool `read_file` pour l'agent support ne l'approuve pas pour l'agent ventes, et n'approuve pas le tool `write_file` sur le même serveur. C'est intentionnel — chaque tool sur chaque serveur MCP élargit la frontière de confiance, et la décision par tool est la façon dont l'org garde la frontière serrée.

## À quoi est bon un serveur MCP

Va vers un serveur MCP quand tu veux qu'un agent atteigne quelque chose qu'aucune intégration premier-party ne couvre — une API interne, un fournisseur sans connecteur Tale, un script local qui fait un calcul que les tools intégrés de Tale ne peuvent pas. Le déploiement est à toi ; Tale ne parle qu'au serveur.

Un motif courant est un serveur MCP par service interne dont les agents ont besoin. Le serveur tourne à côté du reste de l'infrastructure de l'org, parle MCP, et l'équipe propriétaire du service possède aussi le contrat.

## Désactiver et retirer un serveur

Chaque serveur a un commutateur activé sur sa ligne. Désactiver empêche Tale de l'appeler ; les tools du serveur arrêtent d'apparaître dans les listes de tools des agents, et tout agent qui en dépendait fait remonter une erreur de configuration. Retirer le serveur supprime son manifeste et révoque chaque approbation par tool qui le référençait.

Réajouter un serveur avec le même nom repart à zéro — le manifeste est recharché, et chaque approbation par tool doit être redécidée. Pas de report opaque d'approbations à travers un retirer-et-rajouter.

## Serveurs MCP versus intégrations premier-party

Les deux surfaces laissent un agent atteindre au-delà de Tale ; la différence est qui possède le connecteur. Les intégrations premier-party sont spécifiques au fournisseur, livrées en partie de Tale, et portent les identifiants et la liste d'opérations que l'équipe Tale maintient. Les serveurs MCP sont génériques, hébergés par toi, et portent les tools que l'auteur du serveur a choisi d'exposer. Va vers une intégration quand une existe pour le système cible ; va vers un serveur MCP quand tu dois héberger le pont toi-même.

## Où cela s'inscrit

Les serveurs MCP sont la surface d'extension ouverte du toolbelt d'un agent — le levier quand aucune intégration premier-party ne couvre ton besoin. La lecture suivante naturelle est [Vue d'ensemble des intégrations](/fr/platform/integrations/overview) pour le catalogue premier-party, et [Tools d'agent](/fr/platform/agents/tools) pour comment les tools d'un serveur MCP surgissent à l'agent et la frontière de confiance qu'ils élargissent.

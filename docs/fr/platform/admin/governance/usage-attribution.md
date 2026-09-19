---
title: Comment l’usage est compté
description: À qui chaque réponse de chat, exécution d’agent ou requête vocale est imputée, quelles limites s’appliquent et où elle apparaît dans l’analyse de l’usage.
---

Chaque requête d’IA que Tale émet pour ton organisation est enregistrée une fois, imputée à une personne et mesurée par rapport aux [règles de budget](/fr/platform/admin/governance/policies-and-limits) qui s’appliquent à cette personne. Cette page explique qui est cette personne pour chaque type de travail, quelles limites le travail consomme et où tu le retrouves dans l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics). Les membres voient leur propre part sous [Paramètres > Utilisation](/fr/platform/member/preferences#usage-limits).

## Ce qui compte comme usage

Tale enregistre une requête chaque fois qu’un modèle ou un service mesuré tourne pour ton organisation : une réponse de chat, y compris une réponse régénérée ou modifiée et les deux côtés d’une comparaison de modèles ; le court appel de modèle qui donne son titre à un nouveau chat ; un tour d’un agent géré qui travaille sur une tâche ou dans une automatisation ; une sortie vocale ; la transcription d’un enregistrement téléversé ; et un appel de connecteur mesuré. Chaque enregistrement porte les tokens ou unités consommés et le coût estimé d’après le tarif public du fournisseur à ce moment-là.

## À qui une requête est imputée

La règle est la même partout : une requête compte pour la personne qui a demandé le travail. La porte par laquelle elle est arrivée, l’application, l’API REST ou le point d’accès MCP, n’y change rien.

| Travail | Compte pour | Compte aussi pour | Apparaît dans l’analyse de l’usage comme |
| --- | --- | --- | --- |
| Une réponse de chat, ou le titre d’un nouveau chat | Le membre qui a envoyé le message | La clé API, quand le message est passé par l’API REST | L’assistant utilisé ; un titre sous `thread-title` |
| Une exécution d’agent sur une tâche | Le membre qui a lancé l’exécution depuis la tâche ou avec un commentaire qui mentionne l’agent | — | Le nom de l’agent sous **Principaux assistants** |
| Une exécution d’automatisation lancée par quelqu’un | Le membre qui l’a lancée depuis la liste des exécutions, le builder, un chat, une tâche, l’API REST ou le point d’accès MCP | La clé API, quand l’exécution a été lancée avec une clé | Le nom de l’automatisation sous **Principaux assistants** |
| Une exécution d’automatisation lancée par un déclencheur | Personne : une planification, un webhook ou un événement n’a personne derrière lui | — | La ligne **Automatisations (déclencheurs)** sous **Utilisation par utilisateur** |
| Une sortie vocale ou une transcription | Le membre qui l’a demandée | — | **Sortie vocale** ou **Transcription** sous **Principaux assistants** ; la sortie vocale aussi sous **Principaux modèles vocaux** |
| Un appel de connecteur mesuré | Le membre dont la requête a provoqué l’appel | — | L’assistant qui l’a fait, ou **Connector** |

Une nouvelle tentative d’une exécution d’agent poursuit l’exécution lancée par son initiateur ; son usage reste donc imputé à cette personne. Quand une intégration agit avec une clé API pour un autre membre, l’exécution compte pour ce membre, et la limite de la clé la compte aussi.

## Quelles limites s’appliquent

- **Les limites personnelles, d’équipe et de rôle** s’appliquent à la personne à qui une requête est imputée. Une exécution lancée par une planification, un webhook ou un événement n’a pas de telle personne et n’est mesurée par rapport à aucune d’elles.
- **Les limites de l’organisation** s’appliquent à toute requête, y compris aux exécutions lancées par un déclencheur.
- **Les limites de clé API** s’appliquent aux requêtes authentifiées par cette clé : les messages de chat qu’elle a envoyés et les exécutions qu’elle a lancées.

Quand une limite est atteinte, Tale refuse la requête suivante avant de l’exécuter et nomme la limite. Un tour d’agent géré est refusé à son démarrage ; un tour déjà en cours conserve l’enveloppe qui lui a été accordée. [Comment les règles se combinent](/fr/platform/admin/governance/policies-and-limits#how-rules-combine) traite le cas où plusieurs règles visent la même personne.

## Trois situations à connaître

**Un collègue mentionne ton agent dans un commentaire de tâche.** Le commentaire lance une exécution, et celle-ci compte pour le collègue qui a écrit le commentaire, pas pour toi en tant que créateur de l’agent.

**Une automatisation planifiée dépense chaque nuit.** Ses exécutions apparaissent sur la ligne **Automatisations (déclencheurs)**. Elles n’augmentent jamais l’usage personnel de quelqu’un ni le nombre d’utilisateurs actifs, et seules les limites de l’organisation peuvent les arrêter. Définis une limite de coût ou de requêtes pour l’organisation si tu as besoin d’un plafond pour elles.

**Une intégration utilise une clé API au nom d’un membre.** Les limites personnelles et d’équipe du membre voient l’exécution, et la limite de la clé aussi. Deux plafonds s’appliquent, et le plus strict refuse en premier.

## Ce que voient les membres

**Paramètres > Utilisation** liste chaque limite qui s’applique au membre connecté avec son utilisation actuelle : les chats envoyés, les sorties vocales demandées et les exécutions d’agents lancées, quelle que soit la façon de les lancer. Les limites partagées d’équipe et d’organisation y figurent aussi, parce qu’elles peuvent être atteintes avant une limite personnelle.

---
title: Comment l’usage est compté
description: À qui chaque réponse de chat, exécution d’agent ou requête vocale est imputée, quelles limites s’appliquent et où elle apparaît dans l’analyse de l’usage.
---

Chaque requête d’IA que Tale émet pour ton organisation est enregistrée une fois, imputée à une personne et mesurée par rapport aux [règles de budget](/fr/platform/admin/governance/policies-and-limits) qui s’appliquent à cette personne. Cette page explique qui est cette personne pour chaque type de travail, quelles limites le travail consomme et où tu le retrouves dans l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics). Les membres voient leur propre part sous [Paramètres > Utilisation](/fr/platform/member/preferences#usage-limits).

## Ce qui compte comme usage

Tale enregistre une requête chaque fois qu’un modèle ou un service mesuré tourne pour ton organisation : une réponse de chat, y compris une réponse régénérée ou modifiée et les deux côtés d’une comparaison de modèles ; le court appel de modèle qui donne son titre à un nouveau chat ; une réécriture avec **Améliorer avec l'IA** dans la boîte de réception ; l’appel de modèle d’une étape `llm` d’automatisation ; un tour d’un agent géré qui travaille sur une tâche ou dans une automatisation ; une image que crée un tel agent ; une sortie vocale ; la transcription d’un enregistrement téléversé ; un appel de connector mesuré ; et un appel aux endpoints de modèles avec une clé API. Chaque enregistrement porte les tokens ou unités consommés et le coût estimé d’après le tarif public du fournisseur à ce moment-là ; pour un appel aux endpoints de modèles, c’est le coût mesuré par la passerelle de modèles.

## À qui une requête est imputée

La règle est la même partout : une requête compte pour la personne qui a demandé le travail. La porte par laquelle elle est arrivée, l’application, l’API REST, le point d’accès MCP ou les endpoints de modèles, n’y change rien.

| Travail | Compte pour | Compte aussi pour | Apparaît dans l’analyse de l’usage comme |
| --- | --- | --- | --- |
| Une réponse de chat, ou le titre d’un nouveau chat | Le membre qui a envoyé le message | La clé API, quand le message est passé par l’API REST | L’assistant utilisé ; un titre sous `thread-title` |
| Une réécriture avec **Améliorer avec l'IA** dans la boîte de réception | Le membre qui l’a demandée | — | `inbox-improve` sous **Principaux assistants** |
| Une exécution d’agent sur une tâche | Le membre qui a lancé l’exécution depuis la tâche, ou avec un commentaire ou une description de tâche qui mentionne l’agent ; pour une exécution lancée par un autre agent ou par une étape d’automatisation, le membre pour qui compte l’exécution de cet agent ou de cette automatisation | — | Le nom de l’agent sous **Principaux assistants** |
| Une exécution d’automatisation lancée par quelqu’un | Le membre qui l’a lancée depuis la liste des exécutions, le builder, un chat, une tâche, l’API REST ou le point d’accès MCP | La clé API, quand l’exécution a été lancée avec une clé | Le nom de l’automatisation sous **Principaux assistants** |
| Une exécution d’automatisation lancée par un déclencheur | Personne : une planification, un webhook ou un événement n’a personne derrière lui | — | La ligne **Automatisations (déclencheurs)** sous **Utilisation par utilisateur** |
| Une exécution d’agent de projet lancée par une planification, ou une exécution qu’un autre agent a lancée depuis une telle exécution | Personne, comme pour l’exécution lancée par la planification elle-même | — | La ligne **Automatisations (déclencheurs)** sous **Utilisation par utilisateur**, et le nom de l’agent sous **Principaux assistants** |
| Une image que crée un agent | La personne pour qui l’exécution de l’agent compte : celle qui l’a lancée, ou personne pour une exécution lancée par un déclencheur | La clé API, quand l’exécution a été lancée avec une clé | Le nom de l’agent ou de l’automatisation sous **Principaux assistants**, et le modèle d’images sous **Principaux modèles** |
| Une sortie vocale ou une transcription | Le membre qui l’a demandée | — | **Sortie vocale** ou **Transcription** sous **Principaux assistants** ; la sortie vocale aussi sous **Principaux modèles vocaux** |
| Un appel de connector mesuré | Le membre dont la requête a provoqué l’appel | — | L’assistant qui l’a fait, ou **Connector** |
| Un appel aux [endpoints de modèles](/fr/develop/use-tale-from-your-editor#model-endpoints) | Le membre dont la clé API l’a envoyé | La clé API | **Appel API direct** sous **Principaux assistants** |

Une nouvelle tentative d’une exécution d’agent poursuit l’exécution lancée par son initiateur ; son usage reste donc imputé à cette personne. Quand une intégration agit avec une clé API pour un autre membre, l’exécution compte pour ce membre, et la limite de la clé la compte aussi.

Le travail dans un projet compte aussi pour ce projet, quelle que soit la personne qui l’a demandé : les chats du projet, avec leurs titres, les réponses lues à voix haute et les appels d’outils de l’assistant ; les exécutions de ses agents et les étapes d’agent et `llm` des automatisations qui y tournent, avec les images qu’elles créent ; et les appels faits avec les propres clés API du projet. Une exécution qui ne nomme aucun projet, d’une automatisation installée dans plusieurs projets, compte pour chacun d’eux ; une automatisation installée dans aucun projet ne compte que pour l’organisation. Une transcription ne compte pas pour un projet.

Les tours de chat, les tentatives vocales et les appels de modèles d’automatisation conservent les projets enregistrés lors de leur admission. Déplacer le chat ou modifier les installations d’une automatisation dans des projets pendant son exécution ne déplace ni sa réservation ni son usage comptabilisé ensuite. Une tentative admise sans projet reste hors des budgets de projet.

Une clé API qu’un admin a créée pour un membre compte pour ce membre, comme sa propre clé. Une clé qui appartient à une équipe, à un projet ou à l’organisation ([Clés API](/fr/platform/admin/api-keys#create-a-key-for-someone-else)) n’est pas une personne : ce qu’elle demande compte pour la clé elle-même. L’analyse de l’usage la présente sur sa propre ligne sous **Utilisation par utilisateur**, sous le nom de la clé avec son équipe, son projet ou l’organisation en dessous, et ne la compte jamais comme utilisateur actif. La clé d’une équipe compte aussi dans l’usage de son équipe.

## Quelles limites s’appliquent

- **Les limites personnelles, d’équipe et de rôle** s’appliquent à la personne à qui une requête est imputée. Une exécution lancée par une planification, un webhook ou un événement n’a pas de telle personne et n’est mesurée par rapport à aucune d’elles. La clé propre d’une équipe, d’un projet ou de l’organisation non plus, sauf que la clé d’une équipe est tenue par la limite de son équipe.
- **Les limites de l’organisation** s’appliquent à toute requête, y compris aux exécutions lancées par un déclencheur.
- **Les limites de clé API** s’appliquent aux requêtes authentifiées par cette clé : les messages de chat qu’elle a envoyés, ses appels aux endpoints de modèles et les exécutions qu’elle a lancées.
- **Les limites de projet** s’appliquent au travail dans ce projet, quelle que soit la personne qui l’a demandé, y compris aux exécutions lancées par un déclencheur.

Quand une limite est atteinte, Tale refuse la requête suivante avant de l’exécuter et nomme la limite. Un tour d’agent géré est refusé à son démarrage ; un tour déjà en cours conserve l’enveloppe qui lui a été accordée. Une image que l’agent demande pendant son tour est vérifiée à part, avant l’appel au modèle d’images : si une limite est atteinte, Tale refuse l’image et le tour continue. L’image puise aussi dans l’enveloppe du tour qui l’a demandée. L’étape `llm` d’une automatisation est vérifiée avant chaque appel de modèle : si une limite refuse l’appel, l’étape échoue avec `budget_exceeded` et son erreur nomme la limite ; l’exécution échoue avec elle, sauf si le `onError` de l’étape vaut `continue`. L’étape réserve l’entrée estimée et la sortie autorisée au tarif du catalogue, ainsi qu’une requête, jusqu’à la comptabilisation. Les appels simultanés tiennent donc compte de leurs réservations respectives. Si le résultat du fournisseur reste inconnu, Tale comptabilise une seule fois l’estimation enregistrée au lieu de la libérer silencieusement ; une nouvelle tentative passe par une nouvelle admission. Le titre d’un chat et une réécriture avec **Améliorer avec l'IA** sont vérifiés de la même façon avant que Tale appelle le modèle, par rapport à une estimation du coût le plus élevé que l’appel peut atteindre — pour une réponse écrite, le prompt et la plus longue réponse que l’appel permet — et réservent ce montant pendant l’appel. Un titre refusé n’est pas une erreur : le chat est alors nommé d’après son premier message, sans appel de modèle. Une réponse de chat réserve aussi chaque tour supplémentaire de son utilisation d’outils, dès que ce tour commence. [Comment les règles se combinent](/fr/platform/admin/governance/policies-and-limits#how-rules-combine) traite le cas où plusieurs règles visent la même personne.

La sortie vocale réserve son coût estimé et une requête tant que la tentative est en cours. Une tentative déjà réservée qui échoue ou dont le résultat reste inconnu est comptabilisée une seule fois selon cette estimation, y compris si l’échec précède l’appel au fournisseur. Cette comptabilisation prudente ne confirme pas une facturation. Une nouvelle tentative tient compte de l’estimation précédente lors de la vérification du budget restant.

## Trois situations à connaître

**Un collègue mentionne ton agent dans un commentaire ou dans la description d’une tâche.** Publier le commentaire ou enregistrer la description lance une exécution, et celle-ci compte pour le collègue qui en est l’auteur, pas pour toi en tant que créateur de l’agent.

**Une automatisation planifiée dépense chaque nuit.** Ses exécutions apparaissent sur la ligne **Automatisations (déclencheurs)**. Elles n’augmentent jamais l’usage personnel de quelqu’un ni le nombre d’utilisateurs actifs, et seules les limites de l’organisation peuvent les arrêter, ou celles d’un projet quand l’automatisation y tourne. Définis une limite de coût ou de requêtes pour l’organisation ou le projet si tu as besoin d’un plafond pour elles.

**Une intégration utilise une clé API au nom d’un membre.** Les limites personnelles et d’équipe du membre voient l’exécution, et la limite de la clé aussi. Deux plafonds s’appliquent, et le plus strict refuse en premier.

## Ce que voient les membres

**Paramètres > Utilisation** liste chaque limite qui s’applique au membre connecté avec son utilisation actuelle : les chats envoyés, les sorties vocales demandées, les appels aux endpoints de modèles et les exécutions d’agents et d’automatisations lancées, quelle que soit la façon de les lancer. Les limites partagées d’équipe et d’organisation y figurent aussi, parce qu’elles peuvent être atteintes avant une limite personnelle. La limite d’un projet n’y figure pas ; une requête qu’elle refuse la nomme.

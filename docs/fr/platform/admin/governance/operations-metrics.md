---
title: Métriques d’exploitation
description: Surveille les réponses de chat en échec ou bloquées, le travail des agents dans la sandbox, l’issue des exécutions d’automatisation et l’avancement d’un projet sous Paramètres > Métriques.
---

À côté de [Utilisation](/fr/platform/admin/governance/usage-analytics) et [Retours](/fr/platform/admin/governance/feedback-analytics), **Paramètres > Métriques** propose aux admins et aux propriétaires quatre autres tableaux de bord. **Santé de l'assistant** montre si les réponses de l’assistant échouent ou sont bloquées, **Tours de harness** si les agents mènent leur travail à terme dans la sandbox, **Automatisations** comment se terminent les exécutions réelles et **Projets** comment avancent les tâches d’un projet. Chaque tableau recalcule ses chiffres pour la période choisie à partir des enregistrements que Tale conserve encore.

<Frame caption="Paramètres > Métriques > Santé de l’assistant : les compteurs et les taux, le graphique quotidien des résultats et la répartition par agent et par modèle.">

![Le tableau de bord Santé de l’assistant sur les sept derniers jours indique sept réponses de l’assistant, un taux d’erreur de 0 %, un taux de blocage de 0 % et aucun événement de garde-fou, une barre de sept réponses réussies le jour même et une répartition qui attribue toutes les réponses à des chats simples et les partage entre deux modèles.](/images/platform/metrics-chat-health.webp)

</Frame>

## Vérifier la santé de l’assistant

Ouvre **Santé de l'assistant** quand des membres signalent des réponses en échec ou refusées. Choisis 1, 7 ou 30 jours sous **Filtre** ; la page s’ouvre sur 7 jours.

Les cartes comptent les **Réponses de l'assistant** produites pendant la période. Le **Taux d'erreur** est la part de ces réponses qui se sont terminées par une erreur, et le **Taux de blocage** la part que Tale a refusé de fournir, par exemple parce qu’un garde-fou a bloqué le message. **Événements guardrails** compte les détections de la période et le nombre de messages qu’elles ont bloqués.

**Réponses au fil du temps** répartit les réponses de chaque jour entre **Réussies**, **Erreurs** et **Bloquées**, pour voir quand un problème a commencé. **Répartition** donne la part de chaque agent et de chaque modèle ; une réponse dans un chat simple, hors de tout agent, compte comme **Non attribué**.

Sous **Erreurs**, **Par type d'erreur** regroupe les échecs, par exemple **Limite de débit**, **Modèle introuvable**, **Crédits épuisés** ou **Limite d'utilisation atteinte**, et **Erreurs récentes** liste les plus récentes avec leur modèle et leur agent. Le type indique la vérification suivante : les identifiants d’un fournisseur ou son quota sous [Fournisseurs IA](/fr/platform/admin/providers), la disponibilité d’un modèle sous [Modèles](/fr/platform/admin/governance/content-models) ou une règle de budget sous [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

**Garde-fous** détaille les événements par type et par filtre, et trace chaque jour les détections, les blocages et les erreurs de filtre. Ces événements proviennent des filtres configurés dans [Garde-fous](/fr/platform/admin/governance/guardrails) et ne couvrent que ceux que la conservation garde encore.

## Suivre les tours de harness

Un tour de harness est une étape de travail qu’un harness, comme Claude Code ou Codex, accomplit dans la sandbox : un [agent de projet](/fr/platform/projects/project-agents) qui travaille sur une tâche, ou une étape d’agent dans une automatisation. **Tours de harness** montre si ces tours vont à leur terme. Choisis 7, 30 ou 90 jours ; la page s’ouvre sur 30 jours.

Les cartes indiquent les **Tours au total**, le **Taux de réussite**, le **Taux d'expiration**, la **Durée p95**, dans laquelle 95 % des tours se sont terminés, et, sous **Arrêtés par l'utilisateur**, les tours qu’une personne a interrompus. **Par harness** reprend les tours, le taux de réussite et les expirations pour chaque harness : si le taux d’expiration augmente, tu vois de quel harness il vient. [Choisir un environnement d’agent](/fr/platform/agents/harnesses) explique comment chaque harness fonctionne, et [Gérer la capacité des sandboxes](/fr/platform/admin/sandboxes) où leur capacité se règle.

Si les chiffres ne peuvent pas être chargés, la page le signale et propose **Réessayer** au lieu d’afficher zéro tour ou un tableau **Par harness** vide ; la période choisie reste en place. Si une actualisation échoue, les chiffres déjà affichés restent, avec une note indiquant qu’ils ne sont peut-être plus à jour.

## Suivre les exécutions d’automatisation

**Automatisations** compte les exécutions réelles des automatisations de ton organisation ; les exécutions de test apparaissent dans l’onglet **Exécutions** de chaque automatisation, mais pas ici. Choisis 7, 30 ou 90 jours ; la page s’ouvre sur 30 jours. Chaque carte compare son chiffre à la période de même durée qui précède.

Le **Taux de réussite** est la part des exécutions terminées qui ont réussi : les exécutions échouées ou arrêtées comptent contre lui, tandis que les exécutions en file d’attente, en cours ou en attente ne comptent pas encore. La **Durée moyenne** porte sur les exécutions terminées, et **Exécutions échouées** compte les échecs. **Exécutions au fil du temps** montre le volume quotidien, **Répartition des statuts** l’issue de toutes les exécutions de la période et **Automatisations les plus actives** les dix automatisations qui ont le plus d’exécutions, avec leur taux de réussite, leur durée moyenne, leurs échecs et leur dernière exécution. Ouvre l’onglet **Exécutions** d’une automatisation en échec pour trouver le nœud qui a échoué ; [Examiner les exécutions et corriger les échecs](/fr/platform/automations/execution-logs) te guide.

## Examiner l’avancement d’un projet

**Projets** affiche un projet à la fois : choisis-le sous **Sélectionner un projet**. Si l’organisation n’a qu’un projet, il est déjà sélectionné. Choisis 7, 30 ou 90 jours ; la page s’ouvre sur 30 jours.

| Indicateur | Ce qu’il mesure |
| --- | --- |
| **Terminées** | Les tâches passées à **Terminé** pendant la période, réparties selon leur assignation actuelle : les tâches assignées à un agent et toutes les autres. |
| **Temps de cycle moyen** | Le temps moyen entre le premier passage d’une tâche à **En cours** et son arrivée à **Terminé**. Une tâche qui n’est jamais passée par **En cours** n’a pas de temps de cycle. |
| **Taux d'intervention** | Les modifications demandées lors de la revue et les escalades (questions que des étapes d’agent d’automatisations ont posées à des personnes), rapportées aux exécutions d’agent lancées pendant la période. |
| **Dépenses** | Le coût des exécutions d’agent du projet, avec le nombre d’exécutions lancées et échouées. |

Les graphiques en dessous montrent les tâches ouvertes par statut à la fin de chaque jour, les tâches créées et terminées chaque jour, l’évolution du temps de cycle, les tâches terminées chaque jour réparties entre **Agents** et **Humains**, et les dépenses quotidiennes. Comme celle sous **Terminées**, cette répartition suit l’assignation actuelle de chaque tâche, et non la personne qui l’a terminée. Une tâche assignée à un agent compte pour les agents, bien qu’une personne l’ait passée à **Terminé** ; une tâche non assignée, ou assignée à une personne ou à une automatisation, compte pour les humains. Cela vaut aussi pour les jours passés : si une tâche est ensuite assignée à un agent ou perd son agent, par exemple parce qu’il a été supprimé, elle change de côté. Une tâche créée directement comme **Terminé** ou **Annulé** reçoit son horodatage de fin au moment de sa création. En revanche, le débit quotidien des tâches terminées ne compte que les événements de changement de statut : cette création directe ne compte donc pas comme un événement de fin.

Si le taux d’intervention augmente alors que le nombre d’exécutions reste stable, les personnes renvoient davantage de travail ou les agents posent davantage de questions. Les escalades viennent des étapes d’agent des automatisations qui travaillent sur le projet, et chacune compte le jour où elle est émise, qu’elle reçoive une réponse ou non. Pour le travail renvoyé, lis les tâches en revue avant de modifier les instructions d’un agent dans [Créer et gérer des agents de projet](/fr/platform/projects/project-agents) ; pour les questions, lis les exécutions de l’automatisation qui les a posées, comme l’explique [Examiner les exécutions et corriger les échecs](/fr/platform/automations/execution-logs).

## Bien lire les chiffres

- Chaque tableau de bord s’appuie sur les enregistrements que Tale conserve. Les règles de conservation et les suppressions raccourcissent l’historique : une période vide peut signifier que les enregistrements ont disparu, et non qu’il ne s’est rien passé.
- Une période chargée peut dépasser ce qu’un seul passage lit : Santé de l’assistant, Tours de harness, Automatisations et Projets comptent chacun au plus les 5 000 enregistrements les plus récents d’un même type sur la période. Si Tale affiche un avis sur l’activité récente, réduis la période avant de conclure.
- Les coûts sont l’usage enregistré par l’application, pas la facture d’un fournisseur ; l’[analyse de l’usage](/fr/platform/admin/governance/usage-analytics) explique la différence.

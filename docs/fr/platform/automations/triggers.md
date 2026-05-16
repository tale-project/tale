---
title: Déclencheurs
description: Comment démarrent les automatisations — planifications, webhooks, événements et exécutions manuelles.
---

Un déclencheur nomme le moment où une automatisation démarre et l'entrée avec laquelle elle démarre. Tale en livre quatre formes — planifications, webhooks, événements et exécutions manuelles — et une même automatisation peut en porter n'importe quel mélange, si bien que le même fan-out peut tourner sur une planification nocturne et à chaque webhook entrant d'un système extérieur. Cette page est pour le Développeur ou plus qui câble une automatisation ; la surface de configuration, c'est l'onglet **Déclencheurs** sur n'importe quelle automatisation.

## Planifications

Une planification fait tourner l'automatisation à l'horloge. Ouvre **Déclencheurs > Planifications > Ajouter une planification** et soit tape directement une expression cron (`0 9 * * 1-5` tourne à 09:00 en semaine), soit décris en langage naturel ce que tu veux — « chaque jour ouvré à 9h » — et laisse l'assistant IA traduire. Les cinq préréglages rapides (toutes les 5 minutes, toutes les heures, tous les jours, toutes les semaines, tous les mois) couvrent les cas courants sans rien taper.

Chaque planification tourne en **UTC**. Si ton équipe pense dans un autre fuseau, fais la conversion avant d'enregistrer — `0 9 * * 1-5` vaut 09:00 UTC, soit 10:00 à Zurich en hiver et 11:00 en été. Le champ **Variables du workflow** sur le formulaire de planification te laisse épingler une charge utile JSON avec laquelle l'exécution démarre ; il est pré-rempli depuis le schéma d'entrée de l'automatisation, donc le cas courant, c'est d'ajuster des valeurs au lieu d'écrire la forme de zéro.

## Webhooks

Un webhook donne à l'automatisation une URL sur laquelle des appelants extérieurs peuvent envoyer un POST. Ouvre **Déclencheurs > Webhooks > Ajouter un webhook** et Tale génère une URL de la forme :

```text
https://<ton-hote-tale>/api/workflows/wh/<token>
```

Le jeton dans l'URL, c'est le justificatif d'authentification — quiconque le détient peut déclencher l'automatisation, traite-le donc comme une clé API. Range-le dans le coffre de secrets du système appelant, fais-le tourner en supprimant et recréant le webhook, et audite-le via le [Journal d'audit](/fr/platform/admin/governance#audit-log) quand quelque chose semble louche. Il n'y a pas d'en-tête de signature séparé.

Un appel qui marche ressemble à ça :

```bash
curl -X POST https://your-tale-host/api/workflows/wh/abc123def456 \
  -H "Content-Type: application/json" \
  -d '{"orderId": "ord_42", "amount": 199.00}'
```

Le corps est analysé comme du JSON et mis à disposition comme entrée de l'automatisation. La réponse, c'est `{ "status": "accepted", "workflowSlug": "..." }` pour un appel frais. Envoie un en-tête `X-Idempotency-Key` avec une valeur unique si le système appelant peut rejouer la même requête — Tale reconnaît le rejeu et répond `{ "status": "duplicate", "executionId": "..." }` au lieu de lancer une seconde exécution.

Les webhooks sont limités en débit par IP source pour qu'un appelant bruyant ne puisse pas épuiser le moteur ; les appels au-delà de la limite renvoient `429`. La référence complète de la requête et de la réponse, signatures pour l'ancien schéma signé par Tale comprises sur les anciennes formes de webhook, vit dans [Webhooks](/fr/develop/webhooks).

## Événements

Un déclencheur d'événement fait tourner l'automatisation quand quelque chose se passe à l'intérieur de Tale. Ouvre **Déclencheurs > Événements > Ajouter un déclencheur d'événement**, choisis un type d'événement et ajoute un filtre si l'événement en demande un.

| Type d'événement                | Se déclenche quand                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| `customer.created`              | Une fiche client est ajoutée (manuellement, par import ou via l'API). |
| `customer.updated`              | Une fiche client change.                                              |
| `customer.deleted`              | Une fiche client est supprimée.                                       |
| `conversation.created`          | Une nouvelle conversation est ouverte dans la boîte de réception.     |
| `conversation.message_received` | Une réponse arrive sur une conversation existante.                    |
| `conversation.closed`           | Une conversation est marquée fermée.                                  |
| `workflow.completed`            | Une autre automatisation termine avec succès. Filtrable par source.   |

Le filtre est évalué avant le démarrage de l'automatisation — les événements qui ne correspondent pas sont sautés sans laisser d'exécution sur l'onglet **Exécutions**. L'événement `workflow.completed` en particulier, c'est la façon de chaîner les automatisations : l'une finit, l'autre récupère sa sortie et continue le travail.

## Exécutions manuelles

Le bouton **Tester l'automatisation** dans l'éditeur et l'action **Exécuter** sur une automatisation publiée déclenchent toutes deux une exécution ponctuelle avec l'entrée que tu fournis. Les exécutions manuelles partagent le moteur avec les exécutions planifiées et webhook mais apparaissent sur l'onglet **Exécutions** avec la source de déclenchement étiquetée `manual` — utile pour essayer une nouvelle automatisation avant de la planifier, pour des rattrapages ponctuels et pour rejouer une charge utile issue d'une exécution échouée après avoir corrigé le bogue.

## Plusieurs déclencheurs sur une même automatisation

Une automatisation avec deux déclencheurs — disons, une planification nocturne et un webhook entrant — tourne une fois par déclencheur qui s'allume. Chaque exécution enregistre quel déclencheur l'a lancée, donc l'onglet **Exécutions** et le tableau de bord des métriques montrent tous deux la répartition par source sans perdre la trace par exécution. Mélanger les déclencheurs, c'est le bon mouvement quand le même travail doit se faire à l'horloge et à la demande ; ne duplique pas l'automatisation juste pour attribuer un déclencheur différent.

## Où ça s'inscrit

Les déclencheurs sont la frontière entre Tale et tout ce qui veut démarrer une automatisation. Les quatre formes couvrent à peu près toutes les façons de « démarrer maintenant » : du travail régulier sur une planification, du travail réactif sur un événement, du travail intégré sur un webhook, des exceptions sur une exécution manuelle. La référence côté développement pour la forme de l'URL webhook, l'idempotence et les limites de débit, c'est [Webhooks](/fr/develop/webhooks) ; la trace par exécution que chaque déclencheur laisse derrière lui, ce sont les [journaux d'exécution](/fr/platform/automations/execution-logs).

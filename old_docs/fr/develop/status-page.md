---
title: Page de statut
description: La surface /status publique — ce que chaque composant rapporte, ce que signifie le résumé et comment les monitors externes la consomment.
---

Tale expose une surface de statut publique sur chaque instance, sous `/status` (HTML) et `/status.json` (JSON). Les deux reflètent le même sondage : un health check mis en cache pendant cinq secondes contre les trois backends internes — application, base de connaissances, services web & documents — agrégés en un seul verdict `operational` / `degraded` / `outage`. La page sert deux lecteurs : l'exploitant qui veut une URL unique à vérifier avant de signaler un incident, et l'agent de monitoring externe qui interroge la surface publique de Tale.

Cette page est la référence de fil : ce que chaque champ signifie, quelles valeurs il peut prendre, et ce que la page ne dit volontairement pas. Pour les taux d'erreur par requête ou la disponibilité des fournisseurs IA, la stack d'observabilité documentée sous [Operations](/fr/self-hosted/operate/observability/operations) est la bonne surface.

## Exemple travaillé — récupérer le flux de statut

Le sondage de monitor le plus petit possible est un GET contre `/status.json` :

```bash
curl -s https://your-tale-instance.com/status.json
```

Quand tout va bien, la réponse est :

```json
{
  "status": "operational",
  "checkedAt": "2026-05-15T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "operational" }
  ]
}
```

Les deux endpoints répondent avec `200 OK` et `Cache-Control: public, max-age=5` — même pendant une panne, pour que les monitors externes obtiennent une forme de réponse stable plutôt qu'un timeout.

## Les deux endpoints

| Endpoint       | Usage                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Page HTML lisible par un humain. Langue choisie depuis `Accept-Language` (anglais, allemand, français). Pas de JavaScript, pas d'auto-refresh. |
| `/status.json` | Flux machine-lisible pour les monitors externes — BetterStack, UptimeRobot, Atlassian Statuspage, Datadog Synthetics, tout le reste.           |

Les deux endpoints partagent le même sondage (un seul cache en mémoire est devant les deux), donc la page HTML et le flux JSON ne peuvent pas dériver. Ils diffèrent uniquement par la représentation.

## Forme de fil (`/status.json`)

| Nom                   | Type   | Description                                                                                                                                    |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`              | string | Verdict du résumé : `operational` (chaque composant en service), `degraded` (certains en service, d'autres pas), `outage` (tous hors service). |
| `checkedAt`           | string | Horodatage ISO 8601 du dernier tour de sondage.                                                                                                |
| `components`          | array  | Santé par composant. La forme et l'ordre sont stables entre versions.                                                                          |
| `components[].id`     | string | Identifiant stable du composant : `convex`, `rag` ou `crawler`.                                                                                |
| `components[].status` | string | `operational` ou `outage`. Pas de valeur `degraded` par composant aujourd'hui.                                                                 |

Les champs sont stables entre versions : de nouveaux champs peuvent être ajoutés, les existants ne seront pas renommés ni retirés. Les monitors d'uptime à base de mots-clés peuvent alarmer sur la sous-chaîne sensible à la casse `"status":"outage"` et faire confiance à cette correspondance à travers les upgrades.

## Ce que chaque composant couvre

Les IDs mappent vers des sous-systèmes, pas vers les noms de stack sous-jacents — un choix délibéré pour que la surface publique reste lisible quand la stack change.

| ID        | Couvre                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| `convex`  | Le backend applicatif (lectures, écritures, synchro temps réel). S'il est en panne, l'UI l'est. |
| `rag`     | La base de connaissances — indexation de nouveaux documents et recherche des existants.         |
| `crawler` | Les services web & documents — crawls de site et fetches d'URL à la demande.                    |

Le résumé est binaire au niveau du composant : chaque sous-système est soit joignable et servant (`operational`), soit pas (`outage`). Une future valeur `degraded` par composant (par ex. basée sur la latence) peut atterrir sans casser les consommateurs, parce que `status` accepte déjà le vocabulaire plus large d'`OverallStatus`.

## Comment fonctionne le sondage

Un tour de sondage envoie trois requêtes HTTP en parallèle — une vers chaque endpoint de santé backend — avec un timeout de 2 secondes par sondage. Le résultat est mis en cache cinq secondes dans la mémoire du processus, pour qu'une route `/status` non authentifiée ne puisse pas être transformée en amplificateur de sondage par un appelant hostile. Seul le statut HTTP de chaque amont est inspecté ; les corps de réponse sont jetés immédiatement, pour qu'un amont qui se comporte mal ne puisse pas pousser d'octets dans la réponse publique.

Le processus plateforme lui-même est implicite dans le résumé : si `/status` répond du tout, la plateforme est joignable. `outage` signifie donc que chaque sondage backend a échoué — c'est ce que les utilisateurs voient effectivement, puisqu'aucun des flux côté utilisateur ne fonctionne sans au moins un des trois.

## Ce qui n'est pas sur la page

`/status` est une surface à gros grain — « la plateforme est-elle joignable » — pas une vue de santé au niveau métrique. Elle ne rapporte pas :

- **Taux d'erreur par requête.** Utilise la stack Sentry documentée sous [Operations](/fr/self-hosted/operate/observability/operations).
- **Disponibilité des fournisseurs IA.** La page de statut du fournisseur est la source autoritative.
- **Profondeur de file, histogrammes de latence ou métriques par tenant.** Elles vivent dans les endpoints Prometheus, couverts aussi sous Operations.
- **Services internes uniquement.** La base, le proxy, les workers en arrière-plan — leurs modes de panne passent de toute façon par un des trois composants nommés, donc les exposer séparément ajouterait du bruit sans information.

## Ce qu'il faut scraper

Pour un monitor d'uptime externe, GET `/status.json` à l'intervalle qui convient à la fenêtre d'alerte — 1 à 5 minutes est typique. La réponse est petite (~500 octets) et l'endpoint n'est pas authentifié ; il ne gate volontairement pas derrière un sign-in pour que les monitors puissent l'atteindre sans provisionner d'identifiants.

Pour de l'alerting interne qui va plus loin que le résumé, scrape plutôt les endpoints Prometheus documentés sous [Operations](/fr/self-hosted/operate/observability/operations). `/status` est l'URL que tu mets dans un canal d'incident ; Prometheus est l'URL que Grafana interroge.

## Où ça s'inscrit

La page de statut est la surface exploitant la plus légère — l'URL que quelqu'un touche avant de signaler un incident, l'endpoint qu'un monitor tiers interroge. Le pendant API de cette page est le reste de [Référence API](/fr/develop/api-reference) ; la stack d'observabilité plus profonde pour les exploitants auto-hébergés vit sous [Operations](/fr/self-hosted/operate/observability/operations), et le canal de communication in-app pour les upgrades et problèmes connus est [Quoi de neuf](/fr/platform/admin/whats-new).

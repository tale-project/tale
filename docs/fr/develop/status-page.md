---
title: Page de statut
description: La surface /status publique — ce que chaque service rapporte, ce que signifie le résumé et où elle s'inscrit dans la stack de monitoring de l'exploitant.
---

Tale expose un endpoint `/status` public sur chaque instance. Il renvoie un petit document JSON déterministe plus un rendu HTML qui résume la santé des services de la plateforme : lesquels sont joignables, lesquels sont dégradés et quel est le verdict de résumé. La page s'adresse à deux publics — l'exploitant qui fait tourner l'instance et veut une URL unique à vérifier avant de signaler un incident, et l'intégrateur externe qui fait tourner un agent de monitoring contre les surfaces publiques de Tale.

Cette page couvre le contrat : ce qu'il y a sur la page, à quoi ressemble le JSON, ce qu'il faut scraper et ce que `/status` **ne** dit **pas** (pour cela, il y a Prometheus et Sentry).

## Ce qu'il y a sur la page

La page présente un verdict de résumé en haut — **Tous les systèmes opérationnels** quand chaque service dépendant répond en bonne santé, **Panne partielle** quand au moins un service répond dégradé, **Panne majeure** quand au moins un service répond malsain. Sous le résumé, une ventilation par service liste chaque service de la plateforme avec son état actuel, l'horodatage de la dernière vérification et (sur Cloud) un petit historique des incidents récents.

Le verdict se rafraîchit côté serveur toutes les 30 secondes ; la page sonde et re-rend, donc un onglet ouvert longtemps reste à jour sans rafraîchissement manuel.

## Forme JSON

Le même contenu est disponible en JSON lisible par machine sur `/status.json` — utile pour une sonde d'uptime ou un agrégateur de tableau de bord de statut. La forme :

```json
{
  "rollup": "operational",
  "services": [
    {
      "name": "platform",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "rag",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "crawler",
      "status": "degraded",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    }
  ]
}
```

`rollup` est l'un de `operational`, `partial_outage`, `major_outage`. Le `status` de chaque entrée de service est l'un de `healthy`, `degraded`, `unhealthy`. La forme est stable au fil des versions ; de nouveaux champs peuvent être ajoutés mais les existants ne sont ni renommés ni retirés.

## Ce qu'il faut scraper

Pour une sonde de monitoring tierce, GET `/status.json` à l'intervalle qui convient à la fenêtre d'alerte (1 à 5 minutes est typique). La réponse est petite (~500 octets) et l'endpoint n'est pas authentifié ; il n'est volontairement pas derrière une connexion pour que les moniteurs externes puissent l'atteindre.

Pour une alerte interne plus profonde que le résumé, scrape plutôt les endpoints Prometheus documentés à [Opérations](/fr/self-hosted/operate/observability/operations) — `/status` est une surface à gros grain pour « la plateforme est-elle joignable », pas une vue de santé au niveau métrique.

## Ce qui n'est pas sur la page

`/status` ne rapporte pas les taux d'erreur par requête, la disponibilité des fournisseurs IA ni la profondeur des files d'attente. Elle n'expose pas non plus les services internes — base de données, proxy, workers de fond — parce que leurs modes d'échec passent de toute façon par l'un des services orientés utilisateur. Pour les taux d'erreur par requête, utilise la stack Sentry documentée dans [Opérations](/fr/self-hosted/operate/observability/operations) ; pour la disponibilité des fournisseurs IA, la page de statut du fournisseur fait autorité.

## Où ça s'inscrit

La page de statut est la surface exploitant la plus légère — l'URL que quelqu'un consulte avant de signaler un incident, l'endpoint qu'un moniteur tiers sonde. Pour l'observabilité au jour le jour sur une instance auto-hébergée, [Opérations](/fr/self-hosted/operate/observability/operations) couvre ce qu'il faut scraper et sur quoi alerter ; pour la communication in-app après un upgrade, [Nouveautés](/fr/platform/admin/changelog) est le dialogue de changelog.

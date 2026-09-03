---
title: Webhooks
description: Déclencheurs webhook entrants — poste sur une URL à jeton et une automatisation déployée s'exécute. Gestion du jeton, rotation, idempotence et codes de réponse.
---

Un déclencheur webhook transforme un POST de ton système en exécution d'une automatisation déployée — pas de clé API, pas de SDK, juste une URL que Tale frappe quand tu lies le déclencheur. C'est la bonne couture quand l'appelant est un produit tiers — un prestataire de paiement, un outil de formulaires, un job CI — qui ne sait que tirer une requête HTTP sur une URL que tu lui donnes.

Lis ceci quand tu câbles un système externe qui doit démarrer des automatisations. Pour les appels où tu veux une valeur en retour ou détiens une clé API, la [référence API](/fr/develop/api-reference) est la moitié synchrone.

## Un déclencheur, de bout en bout

Lie un déclencheur webhook à une automatisation — dans l'éditeur de l'automatisation, ou avec `PUT /api/v1/automations/{name}/triggers` et `{"kind": "webhook"}` — et Tale répond une seule fois avec le jeton de l'URL. Ensuite, n'importe quel système démarre une exécution :

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

Le corps devient l'entrée de l'exécution. Un corps qui n'est pas du JSON passe tel quel comme texte au lieu d'être refusé — certains fournisseurs envoient du texte brut — et tout ce qui dépasse 256 Ko est rejeté en **413** — la limite compte les octets au fil de l’arrivée du corps, une livraison trop grosse est donc refusée plutôt que mise en mémoire. Suis l'exécution comme n'importe quelle autre via `GET /api/v1/runs/{runId}` avec une clé API, ou regarde-la dans le produit.

Le vocabulaire complet des réponses :

- **202** `{ "runId": "..." }` — l'exécution a démarré.
- **202** `{ "runId": "...", "duplicate": true }` — une nouvelle livraison d’une livraison déjà acceptée ; `runId` est l’exécution que la première a lancée, et il n’en existe pas de seconde.
- **404** — jeton inconnu, désactivé ou mal tapé. La réponse ne distingue jamais les cas — qui devine n'apprend rien.
- **409** `{ "error": "automation has no deployed version" }` — déploie une version dont les tests passent et le même appel s'exécute.
- **413** — le corps dépasse 256 Ko.

## Le jeton est l'identifiant

Pas de signature, pas de header Authorization : le jeton dans l'URL est tout l'identifiant — traite l'URL comme un mot de passe. Tale n'en stocke qu'un hachage et compare en temps constant ; le texte en clair existe exactement une fois, dans la réponse qui l'a frappé.

URL perdue ou fuitée ? Fais-la tourner — `PUT /api/v1/automations/{name}/triggers` avec `{"kind": "webhook", "rotateToken": true}` frappe un jeton neuf et le répond une fois ; l'ancienne URL meurt aussitôt. Délier le déclencheur (`DELETE .../triggers`, ou dans l'éditeur) la révoque entièrement ; les versions et l'historique d'exécution de l'automatisation restent.

## Idempotence et relances

L’endpoint déduplique les livraisons, parce que chaque fournisseur livre au moins une fois. Deux choses identifient une livraison :

- **Un identifiant de livraison que tu envoies.** Le premier de ces en-têtes présent l’emporte : `Idempotency-Key`, `X-Idempotency-Key`, le `webhook-id` des Standard Webhooks, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. Une répétition avec le même identifiant dans les 24 heures répond **202** avec l’exécution d’origine et `"duplicate": true` — quoi que dise son corps.
- **Le corps lui-même.** Sans en-tête d’identifiant, un corps identique à l’octet posté sur la même URL (et le même `projectId`) en moins de deux minutes est la même livraison. Passé deux minutes, c’est une nouvelle livraison — un heartbeat qui poste le même corps toutes les quelques minutes continue donc de s’exécuter.

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# la même requête à nouveau, autant de fois que tu veux, pendant 24 heures :
# → 202 { "runId": "run_a", "duplicate": true }
```

Relancer est donc sûr de ton côté : relance les timeouts et les réponses non-2xx avec backoff, garde l’identifiant de livraison stable d’une tentative à l’autre, et considère tout **202** comme accepté — `duplicate: true` te dit que la tentative précédente avait déjà abouti. La réponse dit si l’exécution a _démarré_, pas si elle a réussi ; suis-la via `GET /api/v1/runs/{runId}`. Un **409** n’est pas mémorisé : déploie une version et renvoie la livraison.

## Où ça se place

Le webhook est l'entrée sans clé ; tout le reste passe par une clé API. La [page Déclencheurs](/fr/platform/automations/triggers) couvre le côté produit — plannings, événements et webhooks tels que l'éditeur d'automatisation les présente. La [référence API](/fr/develop/api-reference) couvre le démarrage d'exécutions avec clé (`POST /api/v1/automations/{name}/runs`) — la meilleure couture quand l'appelant est ton propre code.

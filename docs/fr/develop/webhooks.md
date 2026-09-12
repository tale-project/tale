---
title: Webhooks
description: Déclencheurs webhook entrants — poste sur une URL à jeton et une automatisation déployée s'exécute. Gestion du jeton, rotation, idempotence et codes de réponse.
---

Un déclencheur webhook transforme un POST de ton système en exécution d'une automatisation déployée — pas de clé API, pas de SDK, juste une URL que Tale frappe quand tu lies le déclencheur. C'est la bonne couture quand l'appelant est un produit tiers — un prestataire de paiement, un outil de formulaires, un job CI — qui ne sait que tirer une requête HTTP sur une URL que tu lui donnes.

Lis ceci quand tu câbles un système externe qui doit démarrer des automatisations. Pour les appels où tu veux une valeur en retour ou détiens une clé API, la [référence API](/fr/develop/api-reference) est la moitié synchrone.

## Un déclencheur, de bout en bout

Lie un déclencheur webhook à une automatisation — dans l'éditeur de l'automatisation, ou avec `PUT /api/v1/automations/{name}/triggers` et `{"kind": "webhook"}` — et Tale répond une seule fois avec le jeton de l'URL. Ensuite, n'importe quel système démarre une exécution :

Choisis l’URL selon le travail à lancer. Pour une exécution de projet, utilise `/api/projects/{id}/automations/webhook/{token}`, comme dans cet exemple. L’automatisation doit être installée dans ce projet actif ; le projet et le token doivent appartenir à la même organisation. Le token autorise l’appel, mais ne permet pas de choisir un projet sans liaison. Pour une exécution sans projet, utilise `/api/automations/webhook/{token}` avec une automatisation qui n’a aucune liaison de projet. Une automatisation liée refuse cette URL globale avec **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED`. Le paramètre de requête `projectId` donne **400** sur les deux URL. Le corps du fournisseur devient une donnée de l’automatisation ; il ne choisit pas le projet.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

L’exécution reçoit `{ "trigger": "webhook", "payload": <body> }`. Lis l’identifiant de commande de l’exemple avec `input.payload.orderId`. Si tu définis un schéma `inputs`, il décrit cet objet englobant. Un corps qui n'est pas du JSON passe tel quel comme texte au lieu d'être refusé — certains fournisseurs envoient du texte brut — et tout ce qui dépasse 256 Kio (262 144 octets) est rejeté en **413** — la limite compte les octets au fil de l’arrivée du corps, une livraison trop grosse est donc refusée plutôt que mise en mémoire. Suis l'exécution comme n'importe quelle autre via `GET /api/v1/projects/{id}/runs/{runId}` avec une clé API, ou regarde-la dans le produit. Pour une livraison sans projet, utilise plutôt `GET /api/v1/runs/{runId}`. Une livraison de projet exige l’URL de ce projet et une clé API dont le détenteur peut le lire.

Le vocabulaire complet des réponses :

- **202** `{ "runId": "..." }` — l'exécution a démarré.
- **202** `{ "runId": "...", "duplicate": true }` — une nouvelle livraison d’une livraison déjà acceptée ; `runId` est l’exécution que la première a lancée, et il n’en existe pas de seconde.
- **400** — un paramètre de requête `projectId` (`INVALID_QUERY`), ou une entrée incompatible avec le schéma `inputs` de l’automatisation (`AUTOMATION_INPUT_INVALID`, chaque problème sous `data.issues`) ; aucune exécution ne démarre.
- **403** `AUTOMATION_PROJECT_FORBIDDEN` — l’automatisation ne peut pas s’exécuter dans le projet de l’URL : il n’existe pas, il est archivé, ou l’automatisation n’y est pas installée. La réponse ne dit jamais lequel et ne nomme pas l’automatisation — une URL fuitée n’est pas un oracle des identifiants de projet de l’organisation.
- **404** — jeton inconnu, désactivé ou mal tapé. La réponse ne distingue jamais les cas — qui devine n'apprend rien.
- **409** — `AUTOMATION_NOT_DEPLOYED` (déploie une version dont les tests passent et le même appel s’exécute), `AUTOMATION_PROJECT_SCOPE_REQUIRED` (une automatisation liée appelée sur l’URL globale — utilise son URL de projet) ou `AUTOMATION_DELIVERY_SCOPE_MISMATCH` (cet identifiant de livraison a d’abord été accepté par un autre périmètre d’URL).
- **413** — le corps dépasse 256 Kio (262 144 octets).
- **429** — le budget de l’expéditeur ou du déclencheur est épuisé ; `Retry-After` nomme l’attente. Les budgets sont plus bas.

## Le jeton est l'identifiant

Pas de signature, pas de header Authorization : le jeton dans l'URL est tout l'identifiant — traite l'URL comme un mot de passe. Tale n'en stocke qu'un hachage et compare en temps constant ; le texte en clair existe exactement une fois, dans la réponse qui l'a frappé.

URL perdue ou fuitée ? Fais-la tourner — `PUT /api/v1/automations/{name}/triggers` avec `{"kind": "webhook", "rotateToken": true}` frappe un jeton neuf et le répond une fois ; l'ancienne URL meurt aussitôt. Délier le déclencheur (`DELETE .../triggers`, ou dans l'éditeur) la révoque entièrement ; les versions et l'historique d'exécution de l'automatisation restent. Lier une autre sorte par-dessus fait la même chose : un `PUT` de `{"kind": "schedule", ...}` sur une automatisation qui porte un webhook vivant répond **200** avec `"revoked": "webhook"` à côté du nom, l’ancienne URL répond 404 dès cet instant, et relier `webhook` plus tard frappe un jeton différent — lis donc `revoked` à chaque liaison que tu scriptes, et ne relie jamais vers une autre sorte tant qu’un partenaire poste encore sur l’URL. Désactiver le déclencheur (`"enabled": false`, ou l’interrupteur dans l’éditeur) ne fait que suspendre l’URL : elle répond le même **404** qu’un jeton qui n’a jamais existé, mais le jeton dort, il n’est pas mort — le réactiver, y compris par un `PUT` ultérieur qui omet simplement `enabled`, ramène la même URL à la vie. Après une fuite, fais tourner ou délie ; ne compte jamais sur l’interrupteur.

## Idempotence et relances

L’endpoint reconnaît les livraisons répétées. La déduplication porte sur le déclencheur et le projet de son URL : le même identifiant peut démarrer une exécution dans chaque projet où l’automatisation est installée. Avant de renvoyer un doublon mémorisé, Tale vérifie encore la liaison et l’état actif du projet. Deux éléments identifient une livraison :

- **Un identifiant de livraison que tu envoies.** Le premier de ces en-têtes présent l’emporte : `Idempotency-Key`, `X-Idempotency-Key`, le `webhook-id` des Standard Webhooks, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. L’identifiant est apparié par sa valeur, quel que soit l’en-tête qui le portait — une passerelle qui recopie l’identifiant de livraison d’un fournisseur sous `Idempotency-Key` livre la même livraison, pas une seconde. Une répétition avec le même identifiant dans les 24 heures répond **202** avec l’exécution d’origine et `"duplicate": true` — quoi que dise son corps.
- **Le corps lui-même.** Sans en-tête d’identifiant, un corps identique à l’octet envoyé à la même URL en moins de deux minutes correspond à la même livraison. Après deux minutes, c’en est une nouvelle. Un heartbeat qui renvoie le même corps toutes les quelques minutes continue donc à démarrer des exécutions.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# la même requête à nouveau, autant de fois que tu veux, pendant 24 heures :
# → 202 { "runId": "run_a", "duplicate": true }
```

Relancer est donc sûr de ton côté : relance les timeouts et les réponses non-2xx avec backoff, garde l’identifiant de livraison stable d’une tentative à l’autre, et considère tout **202** comme accepté — `duplicate: true` te dit que la tentative précédente avait déjà abouti. La réponse dit si l’exécution a _démarré_, pas si elle a réussi ; suis-la via `GET /api/v1/projects/{id}/runs/{runId}`. Un **409** n’est pas mémorisé : déploie une version et renvoie la livraison.

## Budgets

Rien n’authentifie un expéditeur, la porte est donc budgétée deux fois. Chaque adresse d’expéditeur — telle que les proxys de confiance du déploiement la rapportent — reçoit 120 livraisons par minute avec une rafale de 240, facturées avant même la vérification du jeton, si bien qu’un déluge d’URL devinées ne coûte rien de plus à la porte. Chaque déclencheur vérifié reçoit 20 livraisons par minute avec une rafale de 40 : une livraison coûte une exécution durable entière, le même prix qu’un démarrage authentifié par clé. Au-delà de l’un ou de l’autre, la porte répond **429** avec `Retry-After` en secondes entières et l’enveloppe d’erreur habituelle ; recule comme la page [Limites de débit](/fr/develop/rate-limits) le décrit, garde l’identifiant de livraison stable d’une tentative à l’autre, et la relance se lit comme le doublon qu’elle est, pas comme une seconde exécution.

## Où ça se place

Le webhook est l'entrée sans clé ; tout le reste passe par une clé API. La [page Déclencheurs](/fr/platform/automations/triggers) couvre le côté produit — plannings, événements et webhooks tels que l'éditeur d'automatisation les présente. La [référence API](/fr/develop/api-reference) couvre le démarrage d'exécutions avec clé (`POST /api/v1/projects/{id}/automations/{name}/runs`) — la meilleure couture quand l'appelant est ton propre code ; elle honore la même idée d’`Idempotency-Key`, un démarrage relancé là-bas est donc aussi sûr qu’une nouvelle livraison ici.

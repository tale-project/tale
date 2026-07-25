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

Le corps devient l'entrée de l'exécution. Un corps qui n'est pas du JSON passe tel quel comme texte au lieu d'être refusé — certains fournisseurs envoient du texte brut — et tout ce qui dépasse 256 Ko est rejeté en **413**. Suis l'exécution comme n'importe quelle autre via `GET /api/v1/runs/{runId}` avec une clé API, ou regarde-la dans le produit.

Le vocabulaire complet des réponses :

- **202** `{ "runId": "..." }` — l'exécution a démarré.
- **404** — jeton inconnu, désactivé ou mal tapé. La réponse ne distingue jamais les cas — qui devine n'apprend rien.
- **409** `{ "error": "automation has no deployed version" }` — déploie une version dont les tests passent et le même appel s'exécute.
- **413** — le corps dépasse 256 Ko.

## Le jeton est l'identifiant

Pas de signature, pas de header Authorization : le jeton dans l'URL est tout l'identifiant — traite l'URL comme un mot de passe. Tale n'en stocke qu'un hachage et compare en temps constant ; le texte en clair existe exactement une fois, dans la réponse qui l'a frappé.

URL perdue ou fuitée ? Fais-la tourner — `PUT /api/v1/automations/{name}/triggers` avec `{"kind": "webhook", "rotateToken": true}` frappe un jeton neuf et le répond une fois ; l'ancienne URL meurt aussitôt. Délier le déclencheur (`DELETE .../triggers`, ou dans l'éditeur) la révoque entièrement ; les versions et l'historique d'exécution de l'automatisation restent.

## Idempotence et relances

L'endpoint de déclenchement ne déduplique pas : un POST rejoué démarre une seconde exécution. Ce qui rend les relances sûres, c'est l'exécution elle-même — une exécution live pose un checkpoint à chaque nœud terminé, donc une exécution qui reprend après une interruption ne répète jamais un effet déjà produit. Là où une _exécution en double_ resterait fausse, mets ta propre clé de déduplication dans la charge utile et branche dessus dans le premier nœud de l'automatisation.

Relancer est la responsabilité de l'appelant : la réponse te dit si l'exécution a _démarré_, pas si elle a réussi. Un appelant raisonnable rejoue les réponses non-2xx avec backoff et considère 202 comme acquis.

## Où ça se place

Le webhook est l'entrée sans clé ; tout le reste passe par une clé API. La [page Déclencheurs](/fr/platform/automations/triggers) couvre le côté produit — plannings, événements et webhooks tels que l'éditeur d'automatisation les présente. La [référence API](/fr/develop/api-reference) couvre le démarrage d'exécutions avec clé (`POST /api/v1/automations/{name}/runs`) — la meilleure couture quand l'appelant est ton propre code.

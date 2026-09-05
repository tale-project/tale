---
title: Ingestion vidéo
description: Configure comment un déploiement auto-hébergé récupère les transcriptions vidéo au-delà du mur anti-bot de YouTube — le fournisseur de PO tokens intégré, un proxy de sortie et le pool de sessions de navigateur préchauffées.
---

Quand Tale ingère un lien vidéo, il va chercher la transcription de la vidéo avec `yt-dlp`. Les plateformes vidéo — YouTube le plus agressivement — soumettent les requêtes venant d’IP de centres de données et de serveurs à un mur « confirme que tu n’es pas un robot », si bien qu’un déploiement auto-hébergé tout neuf sur une VM cloud peut voir l’ingestion échouer là où un ordinateur portable sur une connexion domestique réussirait. Cette page couvre les trois couches que Tale fournit pour passer outre, de celle qui ne demande aucune configuration à celle qui en demande le plus.

<Info>

Les déploiements **Cloud** managés exécutent ces mesures à ta place — cette page s’adresse aux opérateurs qui font tourner Tale sur leur propre infrastructure.

</Info>

## Couche 1 — le fournisseur de PO tokens (par défaut, sans config)

La mesure la plus efficace à elle seule est un **token de preuve d’origine (PO)** : une valeur signée qui fait passer une requête pour une vraie session de navigateur. Tale embarque un fournisseur de tokens câblé d’origine — le plugin `yt-dlp` est intégré à l’image et un sidecar `bgutil-provider` sert les tokens sur le réseau interne. Aucune variable d’environnement n’est requise ; un `docker compose up` ou `tale deploy` tout frais le fait tourner.

Tu peux pointer `yt-dlp` vers un fournisseur sur un autre hôte avec `VIDEO_INGEST_POT_PROVIDER_URL`, ou fournir un token frappé manuellement avec `VIDEO_INGEST_PO_TOKEN` — les deux sont documentés dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference). Un sidecar en panne ne casse jamais la stack : l’ingestion se rabat sur l’absence de token, exactement comme si la couche était absente.

## Couche 2 — un proxy de sortie

Quand le token seul ne suffit pas — certaines plages d’IP sont signalées quoi qu’il arrive —, achemine la récupération via un **proxy de sortie** sur une IP à laquelle la plateforme fait confiance. Les proxys résidentiels et hébergés chez un FAI fonctionnent le mieux ; les proxys de centre de données et commerciaux sont souvent signalés au même titre que le serveur lui-même.

Règle `VIDEO_INGEST_PROXY_URL` sur l’URL du proxy. Un schéma `socks5h://` résout le DNS au niveau du proxy (le choix le plus sûr) ; `http`, `https`, `socks4`, `socks4a`, `socks5` et `socks5h` sont tous acceptés. La valeur peut porter des identifiants — Tale les efface de chaque ligne de log.

```bash .env
VIDEO_INGEST_PROXY_URL=socks5h://user:pass@residential.example:1080
```

Le proxy s’applique à chaque phase d’une récupération — métadonnées, sous-titres et audio —, si bien que toute l’ingestion partage un seul chemin de sortie de confiance.

## Couche 3 — le pool de sessions de navigateur préchauffées

La mesure la plus forte consiste à présenter des cookies issus d’une **vraie session de navigateur qui a déjà passé la vérification anti-bot**. Tale garde un pool de ces sessions, indexé par domaine, et en confie une à chaque récupération pour que la plateforme voie un visiteur qui revient plutôt qu’un serveur au premier contact.

Les sessions sont stockées chiffrées au repos (le fichier de cookies est scellé avec l’`ENCRYPTION_SECRET_HEX` du déploiement) et ne sont jamais exposées au code exécuté par l’agent — elles ne vivent que dans la couche de récupération côté serveur. Une session qui commence à se faire bloquer est refroidie puis mise hors service automatiquement, et les sessions expirées sont balayées selon un calendrier.

Remplir le pool est une étape avancée et manuelle, et elle passe par l’[API REST](/fr/develop/api-reference) — le produit n’a pas de formulaire pour ça. Capture un fichier de cookies Netscape depuis un navigateur qui a résolu le défi pour la plateforme cible, puis importe-le pour le domaine de cette plateforme :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/browser-sessions/import" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
        '{ domain: $domain, cookiesJar: $cookiesJar, label: "warmed 2026-09-05" }')"
# → 201 { "sessionId": "..." }
```

L’import est l’écriture la plus sensible du déploiement, donc il est verrouillé deux fois : la clé doit appartenir à un administrateur de l’organisation, et l’e-mail de cet administrateur doit figurer dans l’allowlist `TALE_DEPLOYMENT_CONFIG_ADMINS` — la même qui protège la [résidence des données](/fr/self-hosted/configuration/data-residency). Tous les autres reçoivent **403** avec un `code` qui nomme la barrière qui a refusé. Si l’utilisateur de la clé appartient à plusieurs organisations, indique avec `X-Organization-Slug` celle où importer — sans cet en-tête, l’écriture répond **400** ; avec une seule appartenance, tu peux l’omettre. `GET /api/v1/browser-sessions` liste le pool avec le statut, l’expiration et le compteur d’échecs de chaque session — jamais les cookies eux-mêmes. Une session vit 14 jours sauf si `ttlMs` en décide autrement, et seule l’ingestion de liens vidéo puise dans le pool.

<Warning>

Les cookies de compte débloquent le contenu restreint mais mettent le compte en danger si la plateforme signale un usage automatisé. Privilégie des cookies issus d’un compte jetable ou créé pour l’occasion, et ne commite jamais un fichier de cookies dans le gestionnaire de versions.

</Warning>

## De quelle couche ai-je besoin ?

<CardGroup cols="2">

<Card title="Tout juste déployé, certaines vidéos échouent" icon="circle-play">

La couche 1 est déjà active. Réessaie — beaucoup de blocages sont passagers. Ne passe à la couche 2 que si les échecs persistent.

</Card>

<Card title="La plupart des vidéos échouent sur cet hôte" icon="globe">

L’IP du déploiement est probablement signalée. Ajoute un proxy de sortie (couche 2) sur une IP résidentielle.

</Card>

<Card title="Une plateforme précise te bloque encore" icon="key-round">

Préchauffe une session de navigateur pour cette plateforme (couche 3) pour que la récupération présente des cookies déjà validés.

</Card>

<Card title="Référence complète des variables" icon="settings">

Chaque réglage `VIDEO_INGEST_*`, avec ses valeurs par défaut, se trouve dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference).

</Card>

</CardGroup>

## Une attente honnête

Aucune de ces couches ne peut garantir l’ingestion face à une plateforme qui travaille activement à bloquer l’accès automatisé depuis des IP arbitraires. Ensemble, elles font réussir l’ingestion partout où ta sortie est de confiance, et chaque déploiement dispose d’un chemin pris en charge pour escalader. Si une plateforme bloque durement ton serveur, la transcription peut tout de même être amenée à la main — colle-la dans un document [Connaissances](/fr/platform/knowledge/documents).

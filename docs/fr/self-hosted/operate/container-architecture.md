---
title: Architecture des conteneurs
description: Quel conteneur possède quel rôle dans une instance Tale en fonctionnement, le chemin de requête d'un message de chat, et à quoi ressemble une panne de chaque conteneur.
---

Une instance Tale, ce sont neuf conteneurs câblés par docker compose, plus un petit sidecar d'ingestion vidéo. La page d'architecture a couvert à quoi sert chaque conteneur ; cette page est la version opérateur — quel conteneur possède quel rôle, comment un message de chat les traverse, et à quoi ressemble le mode de défaillance quand l'un d'eux meurt.

Lis ceci quand tu es d'astreinte. Reviens-y quand tu décides quel conteneur rouler en premier pendant un upgrade.

## Les conteneurs et leurs rôles

| Conteneur                  | Rôle                                                                                       | Un crash affecte                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `tale-proxy`               | Terminaison TLS + routage en bordure                                                       | Tout l'ingress — aucun client n'atteint l'UI                                      |
| `tale-platform`            | Tier web : SPA + assets statiques, branding, la surveillance SSE de config                 | Le navigateur voit la page de chargement ; l'API sert les onglets en cache        |
| `tale-backend-api`         | Chaque porte applicative : API de l'app, auth, le flux SSE de hints, les portes machine    | L'UI charge, mais aucune donnée ; connexion, chat et téléversements échouent      |
| `tale-backend-worker`      | Exécuteur de jobs : schedules, tours d'agent, ingestion, crawling, indexation RAG, doc-gen | Le chat répond encore ; jobs en arrière-plan, automatisations et ingestion calent |
| `tale-db`                  | Postgres opérationnel — le magasin `tale_app` et le corpus `tale_knowledge`                | Les écritures bloquent ; la recherche de connaissances renvoie vide               |
| `tale-object-store`        | Store de blobs compatible S3 (téléversements, pièces jointes, médias générés)              | Chaque up/download échoue ; les chats en cours sans fichiers continuent           |
| `tale-sandbox-llm-gateway` | Passerelle LLM pour les tours de harness                                                   | Les tours de harness n'atteignent aucun modèle ; le chat n'est pas touché         |
| `tale-sandbox-egress`      | Egress réseau pour le code sandboxé                                                        | `Run code` échoue avec « egress denied » ; le rendu web échoue                    |
| `tale-sandbox`             | Runtime sandbox + navigateur headless pour le rendu web et la génération de documents      | `Run code`, le rendu de crawl web et la génération de documents échouent tous     |

Un conteneur est exposé au réseau public (`tale-proxy` pour HTTPS) ; le reste est purement interne. Le sidecar `tale-bgutil-provider` est best-effort — sa panne ne dégrade que l'ingestion de liens vidéo YouTube.

## Le chemin de requête

Un message de chat fait un aller-retour à travers les conteneurs :

1. Navigateur → `tale-proxy` (TLS terminé).
2. `tale-proxy` → `tale-platform` pour la coquille SPA et les assets, → `tale-backend-api` pour l'API de l'app (`/api/app/*`, `/api/auth/*`) et le flux SSE `/events`.
3. `tale-backend-api` lit la config fournisseur de l'org, choisit le modèle et ouvre un flux vers le fournisseur amont, relayant les tokens en retour sur la voie SSE `/events`.
4. Si l'agent récupère des connaissances : le backend exécute la recherche RAG directement contre la base `tale_knowledge` de `tale-db` — aucun service de récupération séparé sur le chemin.
5. Si l'agent exécute du code : `tale-backend-api` → `tale-sandbox` → `tale-sandbox-egress` pour tout réseau sortant.
6. Le travail plus lourd qu'un tour d'agent essaime — ingestion de documents, génération, une automatisation planifiée — est repris par `tale-backend-worker`, pas par l'api.

Le chemin chaud est court. Si la latence du chat semble anormale, le coupable est presque toujours le fournisseur amont, pas Tale ; l'endpoint de métriques sur `tale-backend-api` expose le temps passé à chaque saut.

## Le plan sandbox

L'exécution de code sandboxé tourne dans `tale-sandbox` avec `tale-sandbox-egress` comme unique couture réseau. La séparation en deux conteneurs est délibérée : `tale-sandbox` lui-même n'a aucun réseau sortant ; chaque requête que fait le code sandboxé passe par `tale-sandbox-egress`, qui bloque les cibles cloud-metadata et de plages privées à la couche IP et — quand l'opérateur pose `SANDBOX_EGRESS_ALLOWLIST` — impose par-dessus une allowlist de noms d'hôtes en refus par défaut. Si le conteneur egress est arrêté, le code sandboxé qui a besoin du réseau échoue en mode fermé avec « egress denied » — pas un timeout silencieux.

Le runtime sandbox embarque Chromium et Playwright, si bien que le backend le réutilise pour le travail headless qu'il ne peut pas faire in-process : rendre une page JavaScript pendant un crawl web, et transformer du HTML généré en PDF ou en image. Ces jobs tournent comme des exécutions sandbox éphémères plutôt que comme du code utilisateur, mais empruntent la même couture d'egress et d'isolation. La sandbox est le seul conteneur qui exécute du code plus ou moins non fiable (scripts de skill fournis par l'utilisateur, appels `Run code` des agents) ; le reste du stack exécute le code propre de la plateforme.

## Modes de défaillance — à quoi ressemble la panne de chaque conteneur

**`tale-proxy` arrêté.** Le handshake TLS échoue ; chaque client voit une erreur de connexion. À l'intérieur de l'hôte, les conteneurs plateforme et backend sont encore debout — redémarre le proxy en premier.

**`tale-platform` arrêté.** Le navigateur reçoit la page de chargement du proxy au lieu de la coquille de l'app ; l'API continue de fonctionner. Les onglets existants avec des assets en cache continuent de parler au backend et ne s'en aperçoivent peut-être qu'au rechargement.

**`tale-backend-api` arrêté.** Le navigateur charge la coquille UI mais rien ne se remplit, et connexion, chat et téléversements échouent tous — c'est le conteneur dont dépend chaque requête applicative. Les deux couleurs de plateforme pointent vers la même api, c'est donc un point de défaillance unique par conception ; le redémarrer est sûr (les sessions sont côté serveur, les clients reconnectent le flux SSE).

**`tale-backend-worker` arrêté.** Le chat répond encore — l'api le sert — mais les automatisations planifiées, les runs de tâche d'agent, l'ingestion de documents et l'indexation RAG calent jusqu'au retour du worker. Les jobs sont at-least-once, donc le travail en cours reprend au prochain passage plutôt que d'être perdu. Scale le worker (`--scale backend-worker=N`) quand la file de jobs est le goulot.

**`tale-db` arrêté.** Les écritures bloquent et la recherche de connaissances renvoie vide ; l'app affiche des toasts « échec de l'enregistrement » à chaque mutation. C'est le seul conteneur dont les données ne sont pas re-dérivables — redémarre-le en premier et confirme qu'il revient sain avant de t'inquiéter du reste.

**`tale-object-store` arrêté.** Chaque téléversement et chaque téléchargement d'un fichier stocké échoue ; les agents qui lisent ou écrivent des documents renvoient une erreur, tandis que les chats qui ne touchent aucun fichier continuent. Le redémarrage du conteneur le résout — les blobs sont sur le volume `object-store-data`, pas dans le conteneur.

**`tale-sandbox` / `tale-sandbox-egress` arrêtés.** Les appels de l'outil `Run code` renvoient une erreur et les scripts de skill échouent. Parce que le backend rend les pages web et génère les documents via le runtime sandbox, un crawl web qui a besoin du rendu JavaScript et la génération de documents échouent aussi en mode fermé pendant que la sandbox est arrêtée. Les agents qui n'utilisent rien de tout cela continuent.

**`tale-sandbox-llm-gateway` arrêté.** Les tours de harness perdent leur chemin vers un fournisseur de modèle. Le chat ordinaire — qui appelle les fournisseurs directement depuis le backend, pas via la passerelle LLM — n'est pas touché.

## Quand `tale-db` revient après un plantage : l'index de recherche de la base de connaissances

Un arrêt brutal de `tale-db` — plantage, kill, redémarrage de l'hôte — peut laisser un bloc mis à zéro dans l'index de recherche BM25 (pg_search) du corpus de connaissances. Les tables sont intactes, mais chaque nouveau chunk écrit dans le corpus fait alors planter le serveur de base de données (« corrupted page pointers »), le serveur redémarre, et le job d'indexation suivant recommence le cycle. L'index est une donnée dérivée : le reconstruire ne perd rien — et le backend s'en charge lui-même.

Au démarrage, chaque conteneur backend (api et worker) vérifie chaque index BM25 de la base de connaissances avec `pdb.verify_index` avant de servir des requêtes ou de consommer des jobs ; la base de connaissances propre à une organisation est vérifiée de la même façon la première fois que le backend y touche. Un advisory lock sur la base de connaissances fait qu'un seul conteneur répare pendant que les autres passent leur tour. La suite dépend de la taille de l'index :

- Jusqu'à `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` (1 GiB par défaut) : le conteneur reconstruit l'index sur place (`REINDEX INDEX`) et le vérifie à nouveau avant de continuer. Le démarrage est retardé du temps de reconstruction — quelques secondes pour un petit corpus.
- Au-delà : le démarrage continue, un job d'arrière-plan reconstruit l'index sans bloquer les lectures (`REINDEX INDEX CONCURRENTLY`), et les documents téléversés entre-temps reçoivent le motif « index rebuilding » dans leur statut d'indexation au lieu de faire planter la base. Ils sont remis en file automatiquement dès que l'index reconstruit passe la vérification.

Le backend journalise toute la séquence ; voici à quoi ressemble un index réparé dans `docker logs tale-backend-api` :

```text
[knowledge] the deployment-default knowledge database: BM25 index private_knowledge.idx_pk_chunks_bm25 is unhealthy (2.9 MB) — rebuilding it now: pdb.verify_index raised: assertion `left == right` failed
[knowledge] the deployment-default knowledge database: rebuilt BM25 index private_knowledge.idx_pk_chunks_bm25 (2.9 MB, inline, 96 ms) — re-verified healthy (4 checks)
```

Chaque réparation — et chaque reconstruction qui n'a pas rendu l'index sain — écrit aussi une ligne dans le journal d'audit (acteur `system` ; action `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled` ou `knowledge_index_repair_failed`) et sonne la cloche des admins de chaque organisation dont le corpus vit dans cette base. Une réparation, c'est une tentative par index et par démarrage de conteneur : si l'index reconstruit échoue encore à la vérification, le backend s'arrête là, refuse les écritures vers ce corpus avec une erreur explicite, et la cloche te le dit — reconstruis alors l'index à la main (`REINDEX INDEX private_knowledge.idx_pk_chunks_bm25` dans la base `tale_knowledge`) ou restaure la base depuis une sauvegarde. Des réparations répétées après des redémarrages pointent vers la façon dont le conteneur est arrêté ; `KNOWLEDGE_INDEX_REPAIR_DISABLED=1` désactive complètement la vérification.

## Où cela s'inscrit

Cette page est la carte de l'opérateur ; l'[Aperçu de l'architecture](/fr/self-hosted/overview) est l'introduction à la même image, la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est l'index par symptôme quand quelque chose a mal tourné. Si tu règles des seuils d'alerte, [Exploitation](/fr/self-hosted/operate/observability/operations) nomme les signaux qui valent la peine d'être câblés.

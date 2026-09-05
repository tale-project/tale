---
title: Dépannage
description: Index par symptôme pour les problèmes que les opérateurs ont réellement rencontrés sur des instances Tale.
---

Cette page est la recherche par symptôme quand quelque chose ne va pas, là, tout de suite. Chaque section commence par ce que l'utilisateur rapporte réellement — ce que le navigateur affiche, sur quoi l'agent échoue, ce que l'écran de téléversement dit — et remonte à la cause et au fix. Tout ce qui n'est pas listé ici est candidat pour une nouvelle section dès qu'il s'est présenté deux fois.

Le côté proactif — signaux qui méritent une alerte, ce qu'il faut câbler à Prometheus — vit dans [Opérations](/fr/self-hosted/operate/observability/operations). Cette page est pour le moment après que la page a sonné.

## Le navigateur voit 502 ou « Bad Gateway »

Le conteneur `tale-proxy` a joint la plateforme, mais la plateforme n'a pas répondu. Soit `tale-platform` est down, soit son endpoint de santé est injoignable. Vérifie l'état du conteneur en premier :

```bash
docker compose ps tale-platform
docker compose logs --tail=200 tale-platform
```

Si le conteneur redémarre, les logs en bas montrent la raison du crash — habituellement une variable d'env mal configurée (mismatch `SITE_URL`, `BETTER_AUTH_SECRET` manquant) ou un échec de connexion Postgres. Fix l'env, redémarre, réessaie. Si le conteneur est sain mais que le navigateur voit encore 502, le proxy est le suspect — `docker compose restart tale-proxy` règle la plupart.

## Le navigateur voit un avertissement TLS

`TLS_MODE=selfsigned` est la cause la plus commune — le navigateur ne fait pas confiance à la CA interne de Caddy à la première visite. Soit fais confiance à la CA sur l'hôte (`docker exec tale-proxy caddy trust`), soit bascule sur `TLS_MODE=letsencrypt` pour un vrai certificat. Le walk complet des modes vit dans [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains).

Si le mode est déjà `letsencrypt`, vérifie les logs du proxy pour les échecs ACME — DNS qui ne résout pas vers l'IP publique de l'hôte et port 80 injoignable depuis l'Internet public sont les deux causes communes.

## L'UI charge mais aucune donnée n'apparaît

Le shell UI sont des assets statiques servis par `tale-platform` ; tout le reste circule par `tale-backend-api` — l'API de l'app en HTTP et le flux SSE de mises à jour en direct sur `/events`. Quand le backend est injoignable, le shell charge et reste vide. Symptômes : spinners qui ne se résolvent jamais, toasts « reconnecting », le champ de chat qui n'accepte jamais un message.

```bash
docker compose logs --tail=200 backend-api
```

Le conteneur backend-api redémarre probablement (cherche un crash dans les logs) ou est injoignable depuis le proxy. Redémarre avec `docker compose restart backend-api` — les sessions sont côté serveur et les clients reconnectent le flux SSE, donc le redémarrage est sûr.

## Téléversements bloqués en « indexation »

L'ingestion de documents tourne dans le backend worker et écrit les fragments extraits et les embeddings dans la base du corpus de connaissances. Un long état « indexation » signifie soit que le worker ne peut pas joindre la base du corpus, soit que le fichier lui-même n'a pas pu être extrait. Vérifie les logs du worker et la base du corpus en premier :

```bash
docker compose logs --tail=200 backend-worker | grep -iE "knowledge|ingest|embed"
docker compose ps db
```

Si les logs montrent des erreurs de connexion à la base du corpus (`knowledge-db` sur le réseau, repliée dans `db` sur un déploiement single-host), redémarre-la (`docker compose restart db`) ; l'ingestion retente à la passe suivante, donc les téléversements n'ont pas à être re-soumis. Si la base est saine mais qu'un téléversement spécifique est bloqué, le fichier lui-même est le suspect — les PDFs corrompus et les documents protégés par mot de passe atterrissent en état d'échec et exigent suppression + re-téléversement.

## La base de connaissances redémarre à chaque téléversement

Chaque ingestion de document échoue de la même façon : la base du corpus (`knowledge-db`, repliée dans `db` sur un déploiement single-host) redémarre, le backend worker perd sa connexion, et le téléversement suivant déclenche le même redémarrage. Le log du serveur — un fichier sous `/var/lib/postgresql/data/log/` dans le conteneur ; `docker compose logs` ne porte que la sortie de l'entrypoint — nomme l'échec à chaque fois :

```bash
docker compose exec knowledge-db sh -c 'grep -h -E "PANIC|signal 6" /var/lib/postgresql/data/log/*.log | tail -n 4'
```

```text
PANIC:  corrupted page pointers: lower = 0, upper = 0, special = 0
LOG:  server process (PID 4711) was terminated by signal 6: Aborted
```

L'index BM25 de mots-clés sur `private_knowledge.chunks` contient une page qui n'a jamais été initialisée, et c'est un arrêt en mode crash du conteneur de base qui en laisse une derrière lui : le serveur étend le fichier d'index pour une écriture en cours, `SIGKILL` arrive avant que la page soit écrite, et la récupération après crash n'a aucun WAL à rejouer pour elle. Les images `tale-db` jusqu'à v0.5.7 arrêtaient Postgres avec `SIGTERM`, que Postgres lit comme un arrêt *smart* — il attend la fin de chaque session client. Un client hors compose qui garde une connexion (un backend sur l'hôte, un `psql` ouvert) a poussé l'arrêt au-delà du délai de grâce, Docker a tué le serveur, et le démarrage suivant a tourné en récupération après crash. Les tables et index ordinaires y survivent ; `pg_search` tombe sur la page à zéro à sa prochaine écriture et panique, et Postgres redémarre pour récupérer — à chaque téléversement.

Confirme que l'index est le coupable avant de réparer quoi que ce soit. Ouvre une session sur la base du corpus — les deux requêtes ne font que lire :

```bash
docker compose exec knowledge-db psql -U tale -d tale_knowledge
```

```sql
select * from pdb.verify_index('private_knowledge.idx_pk_chunks_bm25');
```

Un index sain passe chaque vérification (`passed = t`) ; un index abîmé échoue sur `segment_metadata_valid` ou ne se lit pas du tout. Pour voir la page elle-même, `pageinspect` affiche l'en-tête de la dernière page de l'index — `0 | 0 | 0` est la page jamais initialisée, une page saine affiche `24 | 8184 | 8184` :

```sql
create extension if not exists pageinspect;
select lower, upper, special
from page_header(get_raw_page('private_knowledge.idx_pk_chunks_bm25',
  (pg_relation_size('private_knowledge.idx_pk_chunks_bm25') / 8192 - 1)::int));
```

Puis reconstruis l'index. Il dérive de `private_knowledge.chunks`, donc rien n'est perdu et rien n'est à re-téléverser :

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_bm25;
```

En option, reconstruis aussi l'index vectoriel (il existe dès que le premier embedding a été stocké) et récupère les pages de queue orphelines de la table :

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_embedding_hnsw;
VACUUM private_knowledge.chunks;
```

L'ingestion reprend à la passe suivante du worker. Les images `tale-db` plus récentes que v0.5.7 arrêtent Postgres avec `SIGINT` — l'arrêt *fast*, qui déconnecte les clients, écrit un checkpoint et se termine en quelques secondes même avec des clients attachés — et `compose.yml` pose `stop_signal: SIGINT` pour qu'une image plus ancienne reçoive le même signal. Arrête la stack avec `docker compose stop` ou `docker compose down` et laisse courir le délai de grâce de 60 secondes (la CLI tale arrête les conteneurs de la même manière) ; `docker kill` et débrancher l'hôte sont les deux chemins qui finissent encore en arrêt en mode crash.

## Les réponses chat s'arrêtent au milieu du stream

Le stream de tokens depuis le fournisseur amont est tombé — soit le fournisseur a rate-limité, soit la connexion a timeouté, soit le service du fournisseur est dégradé. Vérifie la page de statut du fournisseur d'abord ; puis regarde dans les logs plateforme :

```bash
docker compose logs --tail=200 tale-platform | grep -E "429|503|stream"
```

Un `429` est le cas commun. Soit le budget de l'org touche le rate limit du fournisseur, soit la clé fournisseur elle-même est throttlée. Basculer le modèle par défaut de l'org sur un fournisseur moins chargé efface le symptôme pendant que l'amont refroidit.

## La sauvegarde échoue avec un toast « saving failed »

Le backend n'a pas pu écrire dans Postgres. Soit `tale-db` est down, soit son disque est plein :

```bash
docker compose ps tale-db
docker compose exec db df -h /var/lib/postgresql/data
```

Un disque à 100 % est l'échec qui produit le plus de visages surpris. Libère de l'espace, redémarre `tale-db`, et les écritures en file flushent. Si le disque a de l'espace, le suspect est l'épuisement du pool de connexions ou un lock — redémarre `backend-api` pour vider le pool.

## L'outil « Exécuter du code » échoue avec « egress denied »

Le conteneur `tale-sandbox-egress` est le seul chemin réseau sortant pour le code en sandbox ; s'il est down ou mal configuré, chaque requête sortante de la sandbox échoue en mode fermé. Vérifie le conteneur egress d'abord :

```bash
docker compose ps tale-sandbox-egress
docker compose logs --tail=100 tale-sandbox-egress
```

Si le conteneur est sain et que tu as défini `SANDBOX_EGRESS_ALLOWLIST`, la requête a touché l'allowlist — étends la variable dans `.env` et recrée `tale-sandbox-egress`. Sans allowlist, le proxy est ouvert au niveau des hôtes ; vérifie plutôt la cible : seul le port 443 est tunnelisé pour HTTPS, et les adresses de métadonnées cloud et de plages privées sont toujours bloquées au niveau IP.

## Le sign-in revient en boucle à l'écran de sign-in

`SITE_URL` ne correspond pas à ce que le navigateur a effectivement demandé. Les cookies d'auth sont scope sur l'URL où la requête a atterri ; un mismatch (slash en queue, port manquant, `http` vs `https`, préfixe base-path) signifie que le cookie posé au callback n'est pas envoyé à la prochaine requête.

Fix `.env` :

```bash
SITE_URL=https://tale.example.com  # exactement ce que l'utilisateur tape
```

Recrée le conteneur plateforme (`docker compose up -d --force-recreate tale-platform`) pour que le changement atterrisse dans le HTML rendu.

## Où obtenir de l'aide

Les instances auto-hébergées ne téléphonent pas à la maison, donc le support commence chez toi. Les deux canaux :

- **GitHub Issues** — bugs et problèmes reproductibles. Le tracker [tale-project/tale](https://github.com/tale-project/tale/issues) a un template qui demande le bundle de diagnostics que `tale diagnostics` produit.
- **Discord** — questions, débats de configuration, triage « est-ce un bug ». L'invitation vit dans le README du repo.

Des diagnostics reproductibles rendent chaque canal plus rapide. `tale diagnostics` collecte les logs assainis, les variables d'env (secrets caviardés) et la santé des conteneurs dans une archive unique qui vaut la peine d'être attachée.

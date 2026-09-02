---
title: Dépannage
description: Index par symptôme pour les problèmes que les opérateurs ont réellement rencontrés sur des instances Tale — ce que l'utilisateur rapporte, ce qui est cassé et quoi faire à ce sujet.
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

Le shell UI, ce sont des assets statiques servis par `tale-platform` ; chaque requête derrière part vers la couche backend. Quand le backend ne peut pas répondre, le shell charge et reste vide. Symptômes : spinners qui ne se résolvent jamais, une bannière hors-ligne, le champ de chat qui n'accepte jamais un message.

Confirme-le en une requête — la page de statut publique sonde exactement cette couche et ne demande aucune connexion :

```bash
curl -sS https://ton-hote.example.com/status.json
# → {"status":"outage","checkedAt":"...","components":[{"id":"backend","status":"outage"}]}
docker compose logs --tail=200 backend-api
```

Le backend redémarre probablement (cherche `[backend] fatal startup error`) ou est injoignable depuis le proxy. Redémarre avec `docker compose restart backend-api` — les sessions vivent dans Postgres et le navigateur recharge à la reconnexion, donc le redémarrage est sûr.

## L'UI marche mais ne se met plus à jour toute seule

Les données apparaissent au rechargement puis rancissent : le changement de quelqu'un d'autre ne remonte jamais, un run terminé continue d'afficher « en cours ». Le navigateur tient une connexion `GET /events` de longue durée vers `backend-api` qui porte des indices d'invalidation, et quand elle tombe il n'y a aucune erreur à voir — la page cesse simplement d'apprendre que quelque chose a changé.

```bash
curl -sS -H "Authorization: Bearer $METRICS_BEARER_TOKEN" \
  https://ton-hote.example.com/metrics/backend | grep hint_streams
# tale_backend_hint_streams_open 0
```

Zéro stream ouvert avec des utilisateurs connectés veut dire que la voie est coupée. La cause habituelle est quelque chose entre le navigateur et le backend qui met en tampon ou timeoute une réponse en streaming — un proxy d'entreprise, un CDN, ou un reverse proxy ajouté devant Caddy. Le proxy de Tale désactive le tampon sur ce chemin ; ce que tu mets devant doit faire pareil.

## Téléversements bloqués en « indexation »

L'ingestion de documents est un job de fond. `backend-worker` le prend, extrait le texte, l'embeddie, et écrit les fragments et les embeddings dans la base du corpus de connaissances. Un long état « indexation » a donc trois suspects, dans cet ordre : aucun worker ne tourne, le worker ne joint pas la base du corpus, ou le fichier lui-même n'a pas pu être extrait.

Commence par la file, parce qu'un worker arrêté ressemble exactement à un worker lent :

```bash
docker compose exec db psql -U tale -d tale_app \
  -c "SELECT name, state, count(*) FROM pgboss.job WHERE name LIKE 'rag.%' GROUP BY 1, 2;"
docker compose logs --tail=200 backend-worker | grep -iE "knowledge|ingest|embed|rag"
docker compose ps knowledge-db
```

Un arriéré en `created` sans aucune ligne `active` veut dire que le worker est down — démarre-le, et il vide l'arriéré tout seul. Si les logs montrent des erreurs de connexion à `knowledge-db`, redémarre la base du corpus (`docker compose restart knowledge-db`) ; l'ingestion retente à la passe suivante, donc les téléversements n'ont pas à être re-soumis. Si la file est vide et la base saine mais qu'un téléversement est bloqué, le fichier lui-même est le suspect — les PDFs corrompus et les documents protégés par mot de passe atterrissent en état d'échec et exigent suppression + re-téléversement.

## Les téléversements ou téléchargements échouent d'emblée

Un téléversement qui ne démarre jamais, ou un document qui se liste mais renvoie 5xx à l'ouverture, désigne le blob store plutôt que la base. Chaque fichier vit dans un store compatible S3, et le navigateur le transfère directement via une URL présignée que le proxy relaie.

```bash
docker compose ps object-store
docker compose logs --tail=100 object-store
```

Si le store est sain, le suspect suivant est l'origine de l'URL présignée : elle est signée contre l'adresse que le navigateur utilise, donc un déploiement dont l'URL publique a changé sans que `OBJECT_STORE_PUBLIC_ENDPOINT` (ou `SITE_URL`) suive signe des URL que le navigateur ne peut pas joindre. Une organisation qui a apporté son propre bucket est un chemin distinct — vérifie que sa policy CORS autorise ton origine pour `GET`, `PUT` et `HEAD`, parce que le test de connexion dans l'app tourne côté serveur et ne l'attrapera pas.

## Les réponses chat s'arrêtent au milieu du stream

Le stream de tokens depuis le fournisseur amont est tombé — soit le fournisseur a rate-limité, soit la connexion a timeouté, soit le service du fournisseur est dégradé. Vérifie la page de statut du fournisseur d'abord ; puis regarde dans les logs plateforme :

```bash
docker compose logs --tail=200 tale-platform | grep -E "429|503|stream"
```

Un `429` est le cas commun. Soit le budget de l'org touche le rate limit du fournisseur, soit la clé fournisseur elle-même est throttlée. Basculer le modèle par défaut de l'org sur un fournisseur moins chargé efface le symptôme pendant que l'amont refroidit.

## La sauvegarde échoue avec un toast « saving failed »

Le backend n'a pas pu écrire dans Postgres. Soit `tale-db` est down, soit son disque est plein :

```bash
docker compose ps db
docker compose exec db df -h /var/lib/postgresql/data
```

Un disque à 100 % est l'échec qui produit le plus de visages surpris. Libère de l'espace et redémarre `db`. Note ce qu'un disque plein coûte ici : la base porte les données applicatives, les sessions et la file de jobs, donc un refus d'écriture arrête aussi le travail de fond. Si le disque a de l'espace, le suspect est l'épuisement du pool de connexions ou un lock — redémarre `backend-api` pour vider le pool.

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

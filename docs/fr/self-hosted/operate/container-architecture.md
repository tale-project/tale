---
title: Architecture des conteneurs
description: Quel conteneur possède quel travail dans une instance Tale en marche, le chemin de requête d'un message chat, et à quoi ressemble une panne de chaque conteneur.
---

Une instance Tale, ce sont dix conteneurs câblés par docker compose. La page d'architecture a couvert à quoi sert chaque conteneur ; cette page-ci est la version de l'opérateur — quel conteneur possède quel travail, comment un message chat y circule et à quoi ressemble le mode de défaillance quand l'un d'eux meurt.

Lis ceci quand tu es d'astreinte. Reviens-y quand tu décides quel conteneur rouler en premier pendant une montée de version.

## Les dix conteneurs, avec leurs tâches

| Conteneur                  | Tâche                                                                                                                                    | Une panne affecte                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `tale-proxy`               | Terminaison TLS + routage en bordure                                                                                                     | Tous les ingress — aucun client ne joint l'UI                                            |
| `tale-platform`            | Serveur UI, livraison des assets statiques, la page `/status` publique                                                                   | Le navigateur voit 502 ; l'API reste joignable                                           |
| `backend-api`              | Chaque requête applicative : auth, API d'app, API machine, WebDAV, le flux de mises à jour — et la recherche de connaissances in-process | L'UI charge mais sans données ; les chats en vol stagnent                                |
| `backend-worker`           | Les jobs de fond : ingestion et embedding de documents, crawl web, runs d'automation, sweeps de rétention, le plan cron                   | L'UI marche toujours ; les téléversements restent en « indexation », les automations dorment |
| `tale-db`                  | Postgres — la base applicative, la file de jobs et le corpus de connaissances                                                            | Les écritures sont refusées ; l'app dégrade vers ce qui est déjà chargé                  |
| `tale-knowledge-db`        | Postgres du corpus de connaissances (fragments de documents, embeddings, pages crawlées)                                                 | La recherche de connaissances renvoie vide ; l'ingestion échoue                          |
| `tale-object-store`        | Le blob store — documents téléversés, pièces jointes de chat, audio, médias générés                                                      | Chaque upload et chaque download échoue ; le reste de l'app marche                       |
| `tale-sandbox-llm-gateway` | Gateway LLM pour les tours sur harness                                                                                                   | Les tours sur harness ne joignent aucun modèle ; le chat n'est pas affecté               |
| `tale-sandbox-egress`      | Sortie réseau pour code sandbox                                                                                                          | L'outil **Exécuter du code** échoue avec « egress denied » ; le rendu web échoue         |
| `tale-sandbox`             | Runtime sandbox + navigateur headless pour le rendu web et la génération de documents                                                    | **Exécuter du code**, le rendu de crawl web et la génération de documents échouent       |

`backend-api` et `backend-worker` sont la même image que `tale-platform`, démarrée dans un rôle différent, et les deux scalent indépendamment — `docker compose up -d --scale backend-worker=3` est une topologie supportée, et c'est précisément pour ça que le compose livré ne leur donne aucun nom de conteneur fixe. Adresse-les par leur nom de service. Un stack `tale deploy` les nomme `<project-id>-backend-api` et `<project-id>-backend-worker`.

`tale-knowledge-db` est un conteneur à part dans le compose livré. Un stack `tale deploy` mono-hôte replie le corpus dans `tale-db` et donne à ce conteneur l'alias réseau `knowledge-db`, si bien que la même chaîne de connexion résout dans les deux cas — si `tale status` n'affiche aucune base de connaissances, c'est pour ça, et `tale-db` est le conteneur à regarder.

Un conteneur est exposé au réseau public (`tale-proxy` pour HTTPS, et optionnellement `tale-sandbox-egress` sortant pour la sandbox) ; le reste est interne seulement, blob store inclus — les blobs atteignent le navigateur via des URL présignées que le proxy relaie sous le chemin du bucket.

## Le chemin de requête

Un message chat fait un aller-retour par les conteneurs :

1. Navigateur → `tale-proxy` (TLS terminé).
2. `tale-proxy` → `tale-platform` pour le HTML, le JS et les assets statiques → `backend-api` pour tout ce qui est sous `/api/`, plus `/events`, `/dav` et l'API machine.
3. `backend-api` lit la config fournisseur de l'organisation, choisit le modèle, ouvre un flux vers le fournisseur amont et renvoie les tokens au navigateur en server-sent events.
4. Si l'agent récupère des connaissances : `backend-api` exécute la recherche in-process, en interrogeant directement la base du corpus — sans service de récupération séparé sur le chemin.
5. Si l'agent exécute du code : `backend-api` → `tale-sandbox` → `tale-sandbox-egress` pour tout appel sortant.
6. Tout ce que le tour a différé — indexer un nouveau téléversement, une automation de suite — se commit dans la file de jobs dans la même transaction que l'écriture, et `backend-worker` le prend.

À côté du flux de tokens, le navigateur tient une connexion `GET /events` de longue durée vers `backend-api`. Elle ne porte aucune donnée, seulement des indices d'invalidation : quand un indice arrive, l'app recharge la requête concernée. Un flux d'indices mort ressemble donc à une UI qui a cessé de se mettre à jour toute seule, pas à une panne.

Le chemin chaud est court. Si la latence du chat semble fausse, le conteneur à blâmer est presque toujours le fournisseur amont, pas Tale ; les histogrammes de requêtes du backend sur `/metrics/backend` exposent le temps passé à chaque saut.

## Le plan sandbox

L'exécution de code en sandbox tourne dans `tale-sandbox`, avec `tale-sandbox-egress` comme seule couture réseau. La séparation en deux conteneurs est délibérée : `tale-sandbox` lui-même n'a aucune sortie réseau ; chaque requête que le code sandbox fait passe par `tale-sandbox-egress`, qui bloque les métadonnées cloud et les plages privées au niveau IP et — quand l'opérateur définit `SANDBOX_EGRESS_ALLOWLIST` — impose en plus une allowlist d'hôtes en refus par défaut. Si le conteneur egress est down, le code sandbox qui a besoin du réseau échoue en mode fermé avec « egress denied » — pas un timeout silencieux.

Le runtime sandbox embarque Chromium et Playwright, donc le backend le réutilise pour le travail headless qu'il ne peut pas faire in-process : rendre une page JavaScript pendant un crawl web, et transformer du HTML généré en PDF ou en image. Ces tâches tournent comme des exécutions sandbox éphémères plutôt que du code utilisateur, mais elles empruntent la même couture d'egress et d'isolation. La sandbox est le seul conteneur qui exécute du code potentiellement non fiable (scripts de compétence fournis par l'utilisateur, invocations **Exécuter du code** d'agent) ; le reste de la stack exécute le code propre à la plateforme.

## Modes de défaillance — à quoi ressemble une panne de chaque conteneur

**`tale-proxy` en panne.** Le handshake TLS échoue ; chaque client voit une erreur de connexion. Dans l'hôte, les conteneurs plateforme et backend restent debout — redémarre proxy en premier.

**`tale-platform` en panne.** Le navigateur obtient 502 du proxy ; l'API continue de marcher. Les onglets navigateur existants avec assets en cache continuent à parler au backend et peuvent ne pas s'en apercevoir avant un rechargement.

**`backend-api` en panne.** Le navigateur charge le shell UI mais rien ne se remplit, et la page `/status` publique affiche `outage` — sa seule sonde est le `/ping` de cette couche. Redémarrer est sûr : les sessions vivent dans Postgres, et le navigateur rétablit son flux d'indices et recharge à la reconnexion.

**`backend-worker` en panne.** Rien ne casse devant l'utilisateur, et c'est ce qui rend cette panne facile à manquer. Les requêtes continuent d'être servies, mais rien de différé ne tourne : les téléversements restent en « indexation », les automations ne partent pas, les sweeps planifiés s'arrêtent. Le travail n'est pas perdu — pg-boss garde les jobs dans Postgres et le worker vide l'arriéré à son retour. Surveille `tale_backend_jobs{state="created"}` qui grimpe sur `/metrics/backend`, parce que le conteneur lui-même n'a pas de healthcheck (il ne sert aucun HTTP) : `tale status` ne dira jamais mieux que `running`.

**`tale-db` en panne.** Chaque écriture est refusée et la plupart des lectures avec elle ; la connexion échoue, et la file de jobs n'accepte plus de travail. Rien ne dégrade en douceur ici — la base est le magasin de référence pour l'application, la file et les sessions.

**`tale-knowledge-db` en panne.** L'ingestion de documents échoue et la recherche de connaissances renvoie vide — les agents qui récupèrent des connaissances obtiennent un ensemble de résultats vide et un avertissement dans le log d'exécution. Le reste de l'app continue de marcher ; les chats sans connaissances ne sont pas affectés. Redémarrer le conteneur règle ça, et les téléversements en vol retentent à la passe suivante. Sur un stack qui a replié le corpus dans `tale-db`, cette panne et celle du dessus sont la même panne.

**`tale-object-store` en panne.** Téléverser un fichier échoue, et ouvrir un fichier déjà téléversé aussi — une liste de documents s'affiche encore depuis la base, mais chaque download renvoie 5xx. Le chat, les tâches et les automations qui ne touchent aucun fichier ne sont pas affectés. Une organisation qui a apporté son propre bucket S3 continue de marcher pendant que le store livré est down.

**`tale-sandbox` / `tale-sandbox-egress` en panne.** Les appels de l'outil **Exécuter du code** retournent une erreur et les scripts de compétence échouent. Parce que le backend rend les pages web et génère les documents via le runtime sandbox, un crawl web qui a besoin de rendu JavaScript et la génération de documents échouent aussi en mode fermé tant que la sandbox est down. Les agents qui n'utilisent aucun de ces éléments continuent de marcher.

**`tale-sandbox-llm-gateway` en panne.** Les tours sur harness perdent leur chemin vers un fournisseur de modèles. Le chat ordinaire — qui appelle les fournisseurs directement depuis le backend, pas via la gateway LLM — n'est pas affecté.

## Où cela s'inscrit

Cette page est la carte de l'opérateur ; la [vue d'ensemble de l'architecture](/fr/self-hosted/overview) est l'introduction à la même image, la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est l'index par symptôme quand quelque chose a mal tourné. Si tu fixes des seuils d'alerte, [Opérations](/fr/self-hosted/operate/observability/operations) nomme les signaux à câbler.

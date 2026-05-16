---
title: Dépannage
description: Carte symptôme-d'abord des problèmes que les opérateurs rencontrent vraiment sur une instance Tale en marche, avec les correctifs qui ont tenu en pratique.
---

Cette page cartographie les problèmes que les opérateurs ont rencontrés sur une instance Tale en marche avec les correctifs qui ont fonctionné. La liste est courte exprès — un catalogue exhaustif de modes de défaillance encourage à survoler le symptôme qui correspond au tien. Parcours les sous-titres jusqu'à ce qu'un colle, puis lis la prose en dessous ; tout ce qui n'est pas listé ici est assez rare pour que le chemin de diagnostic soit le même dans tous les cas : lis les journaux, puis ouvre une issue.

Pour tout symptôme qui n'est pas ci-dessous, le drapeau `--verbose` du CLI `tale` plus les journaux de conteneur par service (voir [Exploitation — Journaux](/fr/self-hosted/operate/observability/operations#logs)) font presque toujours remonter la cause racine. Quand ça ne suffit pas, ouvre une issue sur [GitHub Issues](https://github.com/tale-project/tale/issues) avec la sortie verbose du CLI et l'extrait de journal pertinent attaché.

## La plateforme ne reporte jamais sain

Un conteneur `platform` frais met jusqu'à trois minutes avant que `/tmp/platform-ready` atterrisse, parce que l'entrypoint attend que la synchronisation d'environnement finisse et que `bunx convex deploy` pousse le jeu de fonctions avant de signaler sain. Les lignes `200 OK` de la sonde de santé du proxy arrivent bien avant — elles ne veulent pas dire que l'interface est joignable.

Surveille `docker compose logs -f platform` et attends la ligne `Tale Dev v0.x.x  Ready.`. Si elle n'arrive jamais, trois causes sont courantes. La plus fréquente est un service `convex` injoignable — l'étape de déploiement de la plateforme a besoin que Convex soit en marche avant de pouvoir pousser les fonctions, donc un conteneur Convex qui crashe au démarrage entraîne la plateforme avec lui. La deuxième est un secret mal formé dans `.env` que la synchronisation d'environnement rejette ; cherche `[env-sync] rejecting key` dans les journaux Convex. La troisième est la RAM de l'hôte : la topologie blue-green fait tourner les deux couleurs pendant la bascule, et sur un hôte 8 Go le conteneur green est tué avant son déploiement. Monter l'hôte à 12 Go est la correction.

## « DB_PASSWORD must be set » sur chaque service

`DB_PASSWORD` gate quatre services, et chacun fait remonter une erreur légèrement différente quand la valeur manque :

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` depuis le conteneur de base de données.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` depuis la plateforme.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` depuis le service RAG.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` depuis le crawler.

Ouvre `.env`, pose `DB_PASSWORD` sur une valeur non vide et relance `tale start` (ou `docker compose up`). La variable est lue au démarrage du conteneur, donc un stack en marche ne la prend pas tant que tu ne l'arrêtes pas et ne le redémarres pas. Quand tu te connectes à un Postgres externe, pose `POSTGRES_URL` à la place et laisse `DB_PASSWORD` non défini — les quatre services lisent alors l'URL directement. Le schéma complet vit sur [Déploiement en production — Utiliser une base de données externe](/fr/self-hosted/install/linux-server#using-an-external-database).

## Les éditions de clé de fournisseur ne prennent pas effet

La configuration de fournisseur sous `$TALE_CONFIG_DIR/providers/<name>.json` (et le `.secrets.json` correspondant) est surveillée par le conteneur Convex — enregistrer depuis **Paramètres > Fournisseurs IA** ou éditer le fichier à la main déclenche le même rechargement. Deux cas cassent ça.

Le premier, c'est le fichier de secrets chiffré SOPS quand `SOPS_AGE_KEY` n'est plus défini. Le format de fichier est auto-descriptif, donc le loader refuse d'écraser du contenu chiffré avec du texte clair pour empêcher la perte de données — ça aurait l'air d'un opérateur qui aurait silencieusement rétrogradé son stockage de secrets. Restaure la clé age, ou supprime le fichier chiffré avant de réenregistrer. Le flux complet est sur [Fournisseurs — Changer de mode](/fr/self-hosted/configuration/providers#switching-modes).

Le deuxième, c'est quand le fichier est édité depuis le mauvais point de montage. Le compose de Tale monte `convex-data:/app/data` en écriture sur le service convex, et le même volume en lecture seule sur platform, RAG et crawler. Édite les fichiers depuis l'hôte (le chemin hôte mappé dans `/app/data/platform-config` sur le conteneur convex) ou passe par l'interface ; un `vi` en conteneur contre le montage en lecture seule échoue silencieusement pour les services voisins et n'atteint jamais la veille.

## Les documents restent « en indexation » indéfiniment

L'indexation de documents est un pipeline en plusieurs étapes : le service RAG extrait le texte, le découpe en morceaux, génère des embeddings contre un fournisseur tagué embedding, et écrit les morceaux et les entrées vectorielles dans ParadeDB. Un PDF de cent pages prend quelques minutes ; un export de mille pages peut prendre une demi-heure. La progression est visible par fichier sous **Base de connaissances > Documents**.

Quand l'indexation se bloque indéfiniment, deux causes dominent. Le fournisseur tagué embedding est soit mal configuré, soit en train de rate-limiter — regarde `docker compose logs rag` pour des lignes `provider error` qui nomment le fournisseur défaillant et le code HTTP que l'amont a retourné. Ou le Postgres externe sur lequel tu as pointé Tale n'a pas l'extension `vector` ; le symptôme est `extension "vector" is not available` dans les journaux RAG. Installe pgvector sur l'instance externe d'après [Déploiement en production — Utiliser une base de données externe](/fr/self-hosted/install/linux-server#using-an-external-database).

## Où trouver de l'aide

Les journaux sont le premier endroit où regarder — `docker compose logs -f` pour un flux en direct, `tale logs <service> --tail 200` quand le stack tourne sous `tale deploy`. Le smoke test des conteneurs (`bun run docker:test`) valide le stack complet depuis un état propre et attrape les conflits de port et la dérive de dépendances sur un hôte de développement avant qu'ils n'atteignent la production.

Pour les problèmes qui survivent à une lecture de journal, ouvre une issue sur [GitHub Issues](https://github.com/tale-project/tale/issues) avec la sortie verbose du CLI et le fragment de `compose.yml` que tu fais tourner. Les découvertes liées à la sécurité passent par [Avis de sécurité](/fr/self-hosted/operate/security/advisories) à la place, où un brouillon privé précède la divulgation publique jusqu'à ce qu'un correctif soit disponible.

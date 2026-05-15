---
title: Dépannage
description: Carte symptôme-d'abord des problèmes que les exploitants rencontrent vraiment sur une instance Tale en marche, avec les correctifs qui ont tenu en pratique.
---

Cette page mappe les problèmes que les exploitants ont vraiment rencontrés sur une instance Tale en marche aux correctifs qui ont tenu. La liste est volontairement courte — les catalogues exhaustifs de modes d'échec poussent à survoler le symptôme qui colle au tien. Lis les sous-titres jusqu'à en trouver un qui décrit ce que tu vois, puis lis la prose en dessous. Tout ce qui n'est pas listé ici est suffisamment rare pour que le chemin de diagnostic soit le même dans tous les cas : lire les logs, puis ouvrir une issue.

Pour tout symptôme absent de la liste, le flag `--verbose` du CLI `tale` plus les logs des conteneurs (voir [Exploitation — Logs](/fr/self-hosted/operate/observability/operations#viewing-logs)) remontent presque toujours à la cause racine. Si ça ne suffit pas, ouvre une issue sur [GitHub Issues](https://github.com/tale-project/tale/issues) en y joignant la sortie verbose.

## La platform ne passe jamais ready

Un conteneur frais prend jusqu'à trois minutes avant que `/tmp/platform-ready` se pose, parce que l'entrypoint attend que la synchro d'environnement termine et que `bunx convex deploy` ait poussé le jeu de fonctions avant de signaler healthy. Les lignes `200 OK` de la sonde de santé du proxy arrivent bien avant — elles ne signifient **pas** que l'UI est joignable.

Regarde `docker compose logs -f platform` et attends la ligne `Tale Dev v0.x.x  Ready.`. Si elle n'arrive pas, trois causes sont communes : un service `convex` injoignable (le déploiement de la platform en a besoin debout), un secret malformé dans `.env` que la synchro rejette (cherche `[env-sync] rejecting key` dans les logs de Convex), ou pas assez de RAM sur l'hôte pour que le déploiement vert démarre à côté du bleu. La topologie blue-green suppose 12 Go ; sur un hôte à 8 Go, le conteneur vert est tué avant de déployer.

## « DB_PASSWORD must be set » sur chaque service

`DB_PASSWORD` bloque quatre services et se manifeste depuis chacun avec un message légèrement différent :

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` depuis le conteneur de base de données.
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` depuis la platform.
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` depuis le service RAG.
- `ERROR: DB_PASSWORD or CRAWLER_DATABASE_URL must be set` depuis le crawler.

Ouvre `.env` et fixe `DB_PASSWORD` à une valeur non vide. Relance `tale start` (ou `docker compose up`) — la variable est lue au démarrage du conteneur, donc une stack qui tourne ne prend pas la nouvelle valeur tant que tu ne l'as pas redémarrée. Si tu te branches sur un Postgres externe, fixe plutôt `POSTGRES_URL` et laisse `DB_PASSWORD` vide ; les quatre services lisent alors l'URL directement. Le motif complet est dans [Installation serveur Linux — utiliser une base externe](/fr/self-hosted/install/linux-server#utiliser-une-base-externe).

## Les changements de clé fournisseur ne prennent pas

La configuration des fournisseurs (`$TALE_CONFIG_DIR/providers/<name>.json` et sa sœur `.secrets.json`) est surveillée par le conteneur convex — enregistrer depuis **Paramètres > Fournisseurs IA** ou éditer le fichier à la main déclenchent le même rechargement. Deux cas cassent ça :

- **Le fichier de secrets est chiffré SOPS mais `SOPS_AGE_KEY` n'est plus défini.** Le format de fichier est auto-descriptif, donc le loader refuse d'écraser du chiffré avec du clair pour éviter la perte de données. Restaure la clé age ou supprime le fichier chiffré avant de réenregistrer. Le déroulé complet est dans [Fournisseurs IA — changement de mode](/fr/self-hosted/configuration/providers#changement-de-mode).
- **Tu as édité le fichier dans le mount du conteneur en écriture.** Le compose de Tale monte `convex-data:/app/data` en écriture pour le service convex, et le même volume en lecture seule pour platform/RAG/crawler. Édite les fichiers depuis l'hôte (`$TALE_CONFIG_DIR` côté hôte est mappé sur `/app/data/platform-config` dans le conteneur convex) ou passe par l'UI ; un `vi` dans le conteneur contre le mount lecture-seule échoue silencieusement pour les services frères.

## Les documents restent « en indexation » indéfiniment

L'indexation est une pipeline en plusieurs étapes : le service RAG extrait le texte, le découpe en chunks, génère des embeddings et écrit les vecteurs dans ParadeDB. Un PDF de cent pages prend des minutes ; un export de mille pages peut prendre une demi-heure. La progression est visible par fichier dans **Connaissances > Documents**.

Quand l'indexation cale durablement, deux causes dominent : le fournisseur taggé `embedding` est mal configuré ou rate-limité (cherche `provider error` dans `docker compose logs rag`), ou pgvector manque sur le Postgres externe sur lequel tu as branché Tale. Le second cas apparaît dans les logs RAG sous la forme `extension "vector" is not available` ; installe pgvector sur l'instance externe comme décrit dans [Installation serveur Linux — utiliser une base externe](/fr/self-hosted/install/linux-server#utiliser-une-base-externe).

## Où trouver de l'aide

Les logs sont le premier endroit où aller — `docker compose logs -f` pour un flux live, `tale logs <service> --tail 200` quand une instance tourne déjà sous `tale deploy`. Le smoke-test des conteneurs (`bun run docker:test`) valide toute la stack depuis un état propre et attrape les conflits de port et les dérives de dépendance sur une machine de dev.

Pour les problèmes qui survivent à la lecture des logs, ouvre une issue sur [GitHub Issues](https://github.com/tale-project/tale/issues) avec la sortie verbose du CLI et le snippet `compose.yml` que tu fais tourner. Les trouvailles touchant à la sécurité passent par [Avis de sécurité](/fr/self-hosted/operate/security/advisories) à la place, où un brouillon privé précède la divulgation publique jusqu'à ce qu'un patch soit disponible.

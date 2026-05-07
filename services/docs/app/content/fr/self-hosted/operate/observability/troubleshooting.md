---
title: Dépannage
description: Solutions aux problèmes courants et où trouver de l’aide.
---

## Problèmes courants

### "Docker Engine not found" sous Windows

Docker Desktop n’est pas lancé. Ouvre-le depuis le menu Démarrer ou la barre des tâches, attends que le moteur devienne vert, puis relance ta commande.

### Le navigateur affiche un avertissement de certificat

Tale utilise un certificat auto-signé en dev local. Tu peux passer outre l’avertissement ou le supprimer de manière permanente avec :

```bash
docker exec tale-proxy caddy trust
```

Puis redémarre ton navigateur.

### Platform ne charge pas après `docker compose up`

Attends le message Ready dans les logs. Ça peut prendre jusqu’à deux minutes. Les messages `200 OK` de health check avant ça ne veulent pas dire que l’UI est prête.

### Les réponses IA sont lentes ou échouent

Vérifie ta clé API fournisseur dans Paramètres > Fournisseurs IA. Causes courantes :

- Clé API expirée ou révoquée. Régénère-la sur openrouter.ai et mets-la à jour.
- Crédit insuffisant sur ton compte OpenRouter.
- Le modèle configuré n’est pas disponible pour ton tier.
- Problème réseau entre le serveur Tale et l’API OpenRouter.

### Les documents ne sont pas cherchables après upload

L’indexation tourne en arrière-plan. Après l’upload, le service RAG extrait le texte, le découpe en morceaux, génère les embeddings et écrit dans la base. Les gros fichiers comme des PDF de centaines de pages peuvent prendre plusieurs minutes. Regarde l’indicateur de statut dans Base de connaissances > Documents.

### Le crawling ne remonte aucune page

Après ajout d’un site, le crawler fait un premier passage de la page d’accueil et des liens trouvés. Ça prend quelques minutes selon la taille. Si le compteur reste à 0, regarde `docker compose logs crawler` pour des erreurs. Causes courantes : problèmes SSL sur le site cible ou blocages `robots.txt`.

### Un service échoue avec "DB_PASSWORD must be set"

Tous les services qui se connectent à la DB demandent que `DB_PASSWORD` soit défini dans `.env`. Si tu vois :

- `ERROR: DB_PASSWORD or POSTGRES_PASSWORD must be set` (base)
- `ERROR: DB_PASSWORD or POSTGRES_URL must be set` (platform)
- `ERROR: DB_PASSWORD or RAG_DATABASE_URL must be set` (RAG)

ouvre ton `.env` et assure-toi que `DB_PASSWORD` a une valeur non vide. À la première installation, choisis n’importe quel mot de passe. Si tu comptais sur le défaut, définis-le explicitement maintenant.

### Mot de passe admin oublié

Si tu es verrouillé hors de ton compte admin, un autre admin peut réinitialiser ton mot de passe depuis Paramètres > Membres > ligne du membre > Modifier > Définir le mot de passe. Si aucun admin n’est disponible, quelqu’un avec accès Docker peut utiliser le Convex Dashboard pour mettre à jour l’enregistrement utilisateur directement.

## Problèmes de build et de conteneurs

### Docker build échoue avec "parent snapshot does not exist"

Corruption du cache Docker BuildKit. Fix : purger le cache.

```bash
docker builder prune -f
```

Puis relancer le build.

### Port déjà utilisé

Si `docker compose up` échoue parce que les ports (5432, 8001, 8002, 80, 443) sont pris par d’autres services, utilise l’override test qui mappe sur des ports non conflictuels :

```bash
docker compose -f compose.yml -f compose.test.yml --env-file .env.test -p tale-test up -d --build
```

Il utilise les ports 15432, 18001, 18002, 10080 et 10443.

### Taille d’image inattendue après modifications

Si une image Docker grossit beaucoup après tes changements :

1. Vérifie que les nouvelles dépendances sont installées avec `--no-install-recommends` (apt) ou `--no-cache-dir` (pip/uv).
2. Assure-toi que les dépendances de build restent en stage builder (pas copiées vers runtime).
3. Lance le checker de budget de taille :

```bash
bun run docker:test:image
```

4. Utilise `dive` pour voir quels layers sont les plus gros :

```bash
dive <image>
```

Voir [Contributing Docker guide](/fr/develop/contributing-docker) pour des techniques de réduction.

### La DB affiche des erreurs duplicate key au démarrage

Au premier démarrage, la DB peut afficher un message tel que :

```
ERROR: duplicate key value violates unique constraint
```

C’est inoffensif. Ça arrive quand le script d’init de l’extension `uuid-ossp` tourne de façon idempotente. L’extension est déjà installée par l’image ParadeDB de base et le script gère le conflit proprement.

### Le health check d’un conteneur échoue en permanence

Si un service reste en `starting` ou `unhealthy` :

1. Regarde les logs :

```bash
docker compose logs <service> --tail=50
```

2. Vérifie que `.env` contient toutes les variables requises (notamment `DB_PASSWORD`, `OPENAI_API_KEY`).
3. Vérifie que les dépendances sont saines (ex. platform dépend de db, rag, crawler).
4. Pour platform : laisse jusqu’à 5 minutes pour que le framework Convex compile et déploie les fonctions au cold start.

## Obtenir de l’aide

- Logs : `docker compose logs -f` est toujours le premier endroit où regarder.
- Tests conteneurs : `bun run docker:test` valide tout le stack.
- GitHub Issues : https://github.com/tale-project/tale/issues.
- Convex Dashboard : utile pour inspecter les données brutes et les logs de fonctions lors du debug backend.

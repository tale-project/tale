---
title: Démarrage rapide auto-hébergé
description: Une instance Tale sur un seul hôte sur un serveur neuf en vingt minutes — cloner, configurer deux variables, docker compose up, créer le premier admin.
---

Ce démarrage rapide pose une instance Tale fonctionnelle sur un seul hôte sur un serveur neuf en environ vingt minutes. Le résultat est ta propre organisation qui tourne sur ta propre machine, joignable sur une URL que tu contrôles. C'est le plus petit ensemble de gestes qui te mène à un écran de connexion ; le durcissement pour la production vit sur la page [Linux serveur](/fr/self-hosted/install/linux-server).

Il te faut un hôte avec Docker et Docker Compose installés, un nom DNS qui pointe vers l'hôte (ou la volonté d'utiliser l'IP de l'hôte pour le moment), et les ports 80 et 443 ouverts. Le parcours utilise les fichiers compose fournis tels quels — pas d'édits au-delà des deux variables d'environnement `HOST` et `SITE_URL`.

## Avant de commencer

Vérifie que l'hôte est prêt :

```bash
docker --version
docker compose version
```

Les deux commandes doivent imprimer des chaînes de version. Si l'une manque, installe Docker Engine plus le plugin Compose depuis la doc officielle Docker avant de continuer. Les hôtes de production tournent un Ubuntu LTS récent, un Debian récent ou un Fedora récent ; les runtimes de conteneurs autres que Docker ne sont pas pris en charge.

## Étape 1 — Cloner et régler HOST et SITE_URL

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Ouvre `.env` dans ton éditeur et règle deux variables :

- `HOST` — le nom d'hôte auquel les utilisateurs joindront l'instance (par exemple `tale.example.com` ou l'IP publique de l'hôte pour des tests locaux).
- `SITE_URL` — l'URL complète avec schéma (`https://tale.example.com` ou `http://<host>:80` en local).

Laisse le reste tranquille pour l'instant. Les autres variables ont des défauts sensés ; la [référence d'environnement](/fr/self-hosted/configuration/environment-reference) les nomme toutes.

## Étape 2 — Générer les secrets

Le premier démarrage a besoin de trois secrets initialisés. Le `.env.example` livre des placeholders ; remplace-les par des valeurs issues d'`openssl` :

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env
echo "ENCRYPTION_SECRET_HEX=$(openssl rand -hex 32)" >> .env
echo "DB_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "INSTANCE_SECRET=$(openssl rand -base64 48)" >> .env
```

Ceux-ci sont intégrés aux conteneurs au premier démarrage. Garde le `.env` dans un endroit sûr ; tu ne peux pas récupérer les données si tu perds `ENCRYPTION_SECRET_HEX` ou `DB_PASSWORD`.

## Étape 3 — Lancer docker compose up

```bash
docker compose up -d
```

Le premier passage récupère chaque image et construit le graphe de conteneurs. Compte cinq à dix minutes sur une machine neuve. Quand `docker compose ps` montre chaque service à l'état `running` (ou `healthy`), la plateforme est en route. Les services exposés sont Caddy sur 80 et 443 ; tout le reste est interne.

## Étape 4 — Créer le premier admin

Le premier compte sur une instance toute neuve a besoin d'une clé de bootstrap. L'helper livré en génère une :

```bash
./scripts/get-admin-key.sh
```

Copie la clé que le script imprime. Visite `SITE_URL`, clique **Sign up**, remplis tes nom, e-mail et mot de passe. Sur l'écran suivant, colle la clé admin et crée l'**Organisation**. Tu atterris dans le dashboard avec le rôle **Owner**.

Pour la marche plus profonde sur la règle de bootstrap, voir [Premier admin](/fr/self-hosted/install/first-admin).

## Étape 5 — Visiter SITE_URL

Ouvre `SITE_URL` dans un navigateur. Tu devrais voir le dashboard de ton organisation, la sidebar et une liste d'agents vide. Ajoute un fournisseur sous **Paramètres > Providers**, publie un agent (voir [Créer un agent](/fr/platform/agents/create)), et tu fais la même chose que sur la fin de l'onboarding Cloud.

## Dépannage

- **`docker compose up` se termine sur un conflit de port.** Un autre service sur l'hôte lie déjà 80 ou 443. Arrête-le (`sudo systemctl stop nginx` et compagnie) ou règle `TLS_MODE=external` dans `.env` et place ton reverse-proxy existant devant Tale.
- **La page d'inscription charge mais la clé admin est rejetée.** Relance `./scripts/get-admin-key.sh` — les clés tournent par démarrage. Si le script échoue avec « container not running », le conteneur platform n'a pas encore démarré ; `docker compose ps` te dira quel service est unhealthy.
- **Erreurs HTTPS au premier passage.** Let's Encrypt a besoin que le DNS soit vivant et que le port 80 soit joignable depuis l'internet public avant de pouvoir émettre un certificat. Le temps que la propagation se fasse, navigue en `http://` ou règle `TLS_MODE=selfsigned` dans `.env`.
- **Les conteneurs crash-loopent au démarrage neuf.** Presque toujours des secrets manquants. `docker compose logs platform` nommera la variable manquante telle quelle.

## Où ça s'utilise

Tu as maintenant une instance Tale qui marche, mais l'hôte n'est pas durci pour la production. Le parcours [Linux serveur](/fr/self-hosted/install/linux-server) couvre TLS, pare-feu, utilisateur non-root et les crochets opérationnels que tu veux avant que le vrai trafic n'arrive. Si tu veux gérer l'hôte avec la CLI `tale` plutôt qu'avec `docker compose`, [Installation de la CLI](/fr/self-hosted/install/cli-install) est la lecture suivante.

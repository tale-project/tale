---
title: Installation Linux serveur de production
description: Une installation Linux durcie sur un seul hôte — TLS via Let's Encrypt, pare-feu, utilisateur non-root, et les crochets opérationnels pour y mettre du vrai trafic.
---

Ce parcours prend la forme du [démarrage rapide](/fr/self-hosted/install/quickstart) et la durcit pour le trafic de production. Le résultat est un seul hôte Linux qui fait tourner Tale derrière du vrai TLS, avec un pare-feu, un utilisateur opérateur non-root, et les défauts opérationnels que l'équipe devrait toucher avant de pointer des utilisateurs sur l'URL.

Le parcours vise un Ubuntu LTS récent ou Debian ; les commandes se traduisent une-pour-une vers les distros de la famille RHEL avec `dnf` au lieu d'`apt`. Ne saute rien — l'ordre compte, et chaque étape suppose que la précédente est tombée proprement.

## Avant de commencer

Il te faut :

- Une VM ou un hôte bare-metal avec au moins 8 Go de RAM, 4 vCPU et 100 Go de disque. Le stockage croît avec les pièces jointes et les connaissances.
- Un enregistrement DNS A qui pointe vers l'IP publique de l'hôte. Sans DNS, Let's Encrypt ne peut pas émettre un certificat.
- Les ports 80, 443 joignables depuis l'internet public pour l'émission TLS ; SSH sur le port que ta politique opérateur indique.
- Sudo sur l'hôte.

## Étape 1 — Provisionner la machine

Mets à jour et installe les fondations :

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

Crée un utilisateur opérateur non-root nommé `tale` :

```bash
sudo adduser tale
sudo usermod -aG sudo,docker tale
```

Bascule vers cet utilisateur (`sudo su - tale`) pour le reste du parcours. Opérer Tale en root tire un rayon d'impact plus large pour aucun bénéfice ; le reste des étapes suppose l'utilisateur `tale`.

## Étape 2 — Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

Vérifie avec `docker run hello-world`. Si l'utilisateur ne peut pas lancer docker sans sudo, déconnecte-toi et reconnecte-toi pour reprendre l'appartenance au groupe `docker`.

## Étape 3 — Configurer le pare-feu et le chemin inverse

Autorise seulement ce dont Tale a besoin :

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Si tu places Tale derrière un reverse-proxy existant sur le même hôte (rare sur une installation sur un seul hôte), règle `TLS_MODE=external` dans `.env` et ajuste le pare-feu en conséquence. Le conteneur Caddy à l'intérieur de Tale termine TLS par défaut.

## Étape 4 — Récupérer Tale

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Règle `HOST`, `SITE_URL`, et génère les quatre secrets comme dans le [démarrage rapide](/fr/self-hosted/install/quickstart). Le diff production par rapport au démarrage rapide vit dans l'étape 5 (TLS) et les crochets opérationnels à la fin de ce parcours.

## Étape 5 — TLS via Let's Encrypt

Ouvre `.env` et règle :

| Variable    | Valeur                   |
| ----------- | ------------------------ |
| `TLS_MODE`  | `letsencrypt`            |
| `TLS_EMAIL` | Une boîte ops que tu lis |

Caddy émet et renouvelle le certificat automatiquement en utilisant l'enregistrement DNS des prérequis. Le premier démarrage attend le certificat ; compte un délai d'une minute sur le premier `docker compose up -d` pendant que le défi ACME se joue.

## Étape 6 — Premier démarrage

```bash
docker compose up -d
docker compose ps
```

Chaque service devrait être `running` ou `healthy`. Parcours **Étape 4 — Créer le premier admin** depuis le [démarrage rapide](/fr/self-hosted/install/quickstart) pour atterrir dans le dashboard. Ouvre `SITE_URL` en `https://` — le navigateur ne devrait pas avertir au sujet du certificat.

## Étape 7 — Crochets opérationnels

Avant de pointer des utilisateurs sur l'URL, trois crochets te facilitent la vie plus tard :

- **Sauvegardes.** `tale backup` snapshotte les volumes de données — blobs compris — dans le volume `backups` ; pointe ton outillage hors-hôte vers ce volume plus le workspace du projet et `.env` — voir [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore).
- **Logs.** Tale logue sur stdout. Si l'hôte a journald, `journalctl -u docker` transporte tout ; sinon, pipe vers ton agrégateur.
- **Métriques.** Règle `METRICS_BEARER_TOKEN` dans `.env` et scrape `/metrics` depuis ton Prometheus — voir [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config).

## Tableau des ports

| Port | Direction | Objet                                           | Requis         |
| ---- | --------- | ----------------------------------------------- | -------------- |
| 22   | entrant   | SSH                                             | oui, restreint |
| 80   | entrant   | HTTP, sert pour ACME et 301 vers HTTPS          | oui            |
| 443  | entrant   | HTTPS, trafic principal                         | oui            |
| 53   | sortant   | DNS                                             | oui            |
| 443  | sortant   | fournisseurs de modèles, récupérations d'images | oui            |

## Dépannage

- **L'émission Let's Encrypt échoue.** Le DNS doit résoudre vers l'IP publique de cet hôte depuis l'internet public, et le port 80 doit être joignable depuis l'internet public. Lance `curl -I http://$HOST` depuis une autre machine ; s'il atteint le défi Caddy, le chemin marche.
- **Les conteneurs ne peuvent pas joindre les fournisseurs de modèles.** Le pare-feu sortant de l'hôte bloque peut-être ; vérifie avec `docker compose exec platform curl -I https://api.openai.com`.
- **Les renouvellements TLS échouent plus tard.** Caddy renouvelle 30 jours avant l'expiration ; les échecs apparaissent dans `docker compose logs proxy`. Les deux causes fréquentes sont une boîte `TLS_EMAIL` expirée et un changement DNS qui a cassé l'enregistrement.

## Où ça s'utilise

Tu as maintenant une installation de forme production sur un seul hôte. Deux suites doivent figurer au calendrier — [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) et [Durcissement](/fr/self-hosted/operate/security/hardening). Si ton échelle dépasse un hôte (règle du pouce : environ cent utilisateurs concurrents sur la spec recommandée), l'architecture multi-hôtes vit sur [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture).

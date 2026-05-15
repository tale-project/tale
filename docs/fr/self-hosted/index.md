---
title: Tale auto-hébergé
description: Exploite Tale sur ta propre infrastructure — installe avec la CLI, configure avec des variables d'environnement, upgrade avec `tale deploy`.
---

L'édition auto-hébergée fait tourner Tale dans ton VPC, ton datacentre ou un environnement isolé du réseau. Tu obtiens la plateforme complète sous forme de bundle Docker Compose, tu l'installes avec une seule commande CLI, et tu upgrades avec `tale deploy` — blue-green, sans interruption, exactement comme l'édition [Cloud](/fr/cloud) avance. Chaque fonctionnalité visible par l'utilisateur documentée sous [Platform](/fr/platform) est identique au Cloud ; cette section ne couvre que ce qui est spécifique à l'exploitation de ta propre instance.

Cette section s'adresse à la personne qui installe, configure, observe, upgrade et sauvegarde la stack. Les utilisateurs finaux — Membres, Éditeurs, Développeurs, Admins — consomment [Platform](/fr/platform) directement ; les pages spécifiques au rôle là-bas s'appliquent sur les deux éditions. Les seules surfaces spécifiques à l'auto-hébergement sont l'installation, les fichiers de configuration et les variables d'environnement, l'architecture des conteneurs, l'observabilité, les notes de version, et l'authentification par en-tête HTTP de confiance.

## Dans cette section

Chaque page se tient au niveau d'une décision d'exploitant. La forme : titre en gras, tiret cadratin, une promesse en une phrase.

- **[Vue d'ensemble auto-hébergée](/fr/self-hosted/overview)** — exploitants évaluant la plateforme. Architecture, les cinq services, le choix de base de données, et qui tourne où.
- **[Installation : Démarrage rapide](/fr/self-hosted/install/quickstart)** — premiers installateurs sur Linux/macOS/Windows. Installation locale via la CLI `tale`, parcours de dix minutes.
- **[Installation : serveur Linux](/fr/self-hosted/install/linux-server)** — exploitants déployant sur un serveur de production. TLS, reverse proxy, sous-chemin, durcissement.
- **[Configuration : Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference)** — chaque variable d'environnement `TALE_*`, groupée par service, avec valeurs par défaut.
- **[Configuration : Fournisseurs](/fr/self-hosted/configuration/providers)** — fichiers de configuration des fournisseurs IA : schéma, champs, règles de coût, distinction passerelle / fournisseur direct.
- **[Configuration : Rétention](/fr/self-hosted/configuration/retention)** — politiques de rétention des données par table et comment elles sont appliquées.
- **[Authentification](/fr/self-hosted/admin/authentication)** — mot de passe, SSO Microsoft Entra ID, et intégration par en-têtes HTTP de confiance avec un reverse proxy en amont.
- **[Architecture des conteneurs](/fr/self-hosted/operate/container-architecture)** — comment les cinq services se connectent sur le réseau Docker interne, où les ports sont exposés, et à quoi ressemble le déploiement blue-green.
- **[Observabilité : exploitation](/fr/self-hosted/operate/observability/operations)** — métriques Prometheus, flux de logs, sondes de santé, et ce qu'il faut câbler dans ta stack de monitoring.
- **[Observabilité : Dépannage](/fr/self-hosted/operate/observability/troubleshooting)** — les trois ou quatre problèmes que les exploitants rencontrent vraiment et comment les diagnostiquer sur une instance vivante.
- **[Avis de sécurité](/fr/self-hosted/operate/security/advisories)** — comment Ruler GmbH publie les CVE, comment les exploitants s'abonnent, et le partage de la responsabilité de patching entre le projet et l'exploitant.
- **[Format des notes de version](/fr/self-hosted/operate/release-notes/format)** — le format canonique des notes de version GitHub ; ce qui est dans le périmètre, ce qui n'y est pas, comment les lire avant un upgrade.

## Installer ton instance

Deux chemins d'installation. Choisis celui qui correspond à ton environnement.

- **Laptop ou poste local.** Suis le [Démarrage rapide](/fr/self-hosted/install/quickstart) — `tale init my-project`, `tale start`, ouvre `https://localhost`. Idéal pour évaluer le produit ou pour un usage développeur solo.
- **Serveur Linux de production.** Suis l'[Installation serveur Linux](/fr/self-hosted/install/linux-server) — met en place TLS via Caddy, configure un reverse proxy s'il y en a un en amont, et guide le déploiement en sous-chemin. C'est le chemin canonique pour un usage à l'échelle de l'organisation.

Une fois l'instance debout, chaque Membre, Éditeur, Développeur et Admin que tu intègres lit [Platform](/fr/platform) ; les pages spécifiques au rôle là-bas ne changent pas entre les éditions.

## Configurer et exploiter

Après l'installation, deux surfaces opérationnelles comptent :

- **Configuration** — chaque bouton est soit une variable d'environnement, soit un fichier JSON sous `TALE_CONFIG_DIR`. Les pages de référence sous [Configuration](/fr/self-hosted/configuration/environment-reference) sont exhaustives ; va les voir quand une valeur doit changer.
- **Observabilité** — Tale exporte des métriques Prometheus sur le port de chaque service, écrit des logs structurés sur stdout, et expose une sonde liveness / readiness sur chaque conteneur. La page [Exploitation](/fr/self-hosted/operate/observability/operations) couvre quoi scraper, sur quoi alerter, et ce que chaque ligne de log veut dire.

## Où ça s'inscrit

L'auto-hébergement est la section de l'exploitant. Le produit lui-même — chat, agents, automatisations, connaissances, intégrations, admin — vit une seule fois sous [Platform](/fr/platform) et se lit ici à l'identique. Croise les pages d'installation quand tu mets l'instance debout ; va voir la référence de configuration quand une valeur doit changer ; va voir les pages d'exploitation quand quelque chose va mal en production. Pour les contributions au code source et l'API, [Develop](/fr/develop/api-reference) est une section plus loin.

---
title: Tale auto-hébergé
description: Exploite Tale sur ta propre infrastructure — installe avec la CLI, configure avec des variables d'environnement, upgrade avec `tale deploy`.
kind: index
---

Tale auto-hébergé est le même produit que l'édition [Cloud](/fr/cloud), packagé en une stack Docker Compose à six conteneurs que tu fais tourner sur ta propre infrastructure. La CLI `tale` l'installe, des variables d'environnement et des fichiers JSON sous `TALE_CONFIG_DIR` le configurent, et `tale deploy` l'upgrade en blue-green pour que les utilisateurs ne voient jamais une fenêtre de maintenance. Cette section s'adresse à l'opérateur qui dresse l'instance et la maintient en route ; les utilisateurs finaux — Membres, Éditeurs, Développeurs, Admins — lisent [Platform](/fr/platform), identique en Cloud et auto-hébergé.

Trois fils traversent chaque page ci-dessous. **Installer** couvre le chemin d'une box fraîche jusqu'à une instance qui tourne, sur un laptop ou sur un serveur Linux de production. **Configurer** catalogue les boutons qui existent — variables d'environnement, fichiers fournisseurs, bornes de rétention — et où chacun vit sur disque. **Exploiter** est le régime de croisière — observabilité, dépannage, avis de sécurité, notes de version, les surfaces d'authentification qui branchent Tale à ton fournisseur d'identité.

## Dans cette section

Les pages ci-dessous suivent l'ordre dans lequel un opérateur les atteint typiquement : choisir un chemin d'installation, lire une fois la référence de configuration, puis vivre sur les pages d'exploitation.

- **[Aperçu auto-hébergé](/fr/self-hosted/overview)** — opérateurs qui évaluent la plateforme. Les six conteneurs, où chacun tourne, ce que fait chaque port et chaque volume.
- **[Démarrage rapide](/fr/self-hosted/install/quickstart)** — premiers installateurs sur Linux, macOS ou Windows. Installation locale via la CLI `tale` en une dizaine de minutes.
- **[Déploiement en production](/fr/self-hosted/install/linux-server)** — opérateurs qui déploient sur un serveur de production. TLS, reverse proxies, déploiements en sous-chemin, Postgres externe, upgrades blue-green.
- **[Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference)** — chaque variable d'environnement que Tale lit, groupée par surface, avec valeurs par défaut tirées de `.env.example` et des chargeurs.
- **[Fournisseurs](/fr/self-hosted/configuration/providers)** — fichiers JSON fournisseurs, schéma des coûts, règles de passthrough passerelle / fournisseur direct, et comment pointer Tale vers un Ollama, vLLM ou LocalAI local.
- **[Rétention](/fr/self-hosted/configuration/retention)** — le modèle à trois couches fichier/env/UI, les seize catégories de données, le job de nettoyage nocturne, et le chemin d'effacement RGPD.
- **[Authentification](/fr/self-hosted/admin/authentication)** — mot de passe, SSO Microsoft Entra ID, et intégration par en-têtes HTTP de confiance avec un reverse proxy d'authentification en amont.
- **[Architecture des conteneurs](/fr/self-hosted/operate/container-architecture)** — comment les six services se connectent sur le réseau Docker interne, la carte des volumes, la forme des health-checks, et la topologie blue-green.
- **[Exploitation](/fr/self-hosted/operate/observability/operations)** — métriques Prometheus, flux de logs, sondes de santé, budgets d'image, tests de smoke des conteneurs.
- **[Dépannage](/fr/self-hosted/operate/observability/troubleshooting)** — la poignée de problèmes que les opérateurs rencontrent vraiment, chacun en forme symptôme-cause-correction.
- **[Avis de sécurité](/fr/self-hosted/operate/security/advisories)** — comment les CVE sont coordonnés, comment les opérateurs s'abonnent, à quoi ressemble le partage de responsabilité entre Ruler GmbH et l'opérateur pour les patchs.
- **[Format des notes de version](/fr/self-hosted/operate/release-notes/format)** — la forme canonique des notes de version GitHub, l'ordre des sections, ce que tout opérateur devrait survoler avant `tale upgrade`.

## Installer ton instance

Deux chemins d'installation, choisis selon l'environnement.

- **Laptop ou poste local.** Lis le [Démarrage rapide](/fr/self-hosted/install/quickstart). Un `tale init`, un `tale start`, ouvre `https://localhost` — assez pour évaluer le produit, donner une démo ou développer contre la plateforme. TLS auto-signé par défaut, donc la première visite affiche un avertissement navigateur que tu cliques.
- **Serveur Linux de production.** Lis [Déploiement en production](/fr/self-hosted/install/linux-server). Vraie domaine, TLS Let's Encrypt, topologie blue-green qui survit aux upgrades sans fenêtre de maintenance, Postgres externe en option. C'est le chemin canonique pour mettre Tale devant une équipe.

Une fois l'instance debout, chaque Membre, Éditeur, Développeur et Admin que tu intègres lit [Platform](/fr/platform). Rien dans les sections indexées par rôle là-bas ne change entre les éditions — la différence est le tab d'où ils viennent.

## Configurer et exploiter

Après l'installation, deux surfaces côté opérateur comptent au quotidien.

La surface de **configuration** est `.env` et `TALE_CONFIG_DIR`. Chaque bouton runtime est soit une variable d'environnement lue au démarrage du conteneur, soit un fichier JSON surveillé sur disque ; la [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) est exhaustive et les pages [Fournisseurs](/fr/self-hosted/configuration/providers) et [Rétention](/fr/self-hosted/configuration/retention) sont les pendants fichier-JSON.

La surface d'**exploitation** est la forme à long terme du Tale qui tourne. Les métriques Prometheus vivent sur chaque service, les logs structurés vont sur le stdout Docker, les sondes de santé pilotent les décisions de cutover blue-green. [Exploitation](/fr/self-hosted/operate/observability/operations) est l'index ; [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est la carte symptôme-à-correction quand quelque chose part de travers sur une instance vivante.

## Où ça s'inscrit

L'auto-hébergement est la section de l'opérateur. Le produit lui-même — chat, agents, automatisations, connaissances, intégrations, admin — vit une seule fois sous [Platform](/fr/platform) et se lit à l'identique ici. Croise les pages d'installation quand tu dresses l'instance, la référence de configuration quand une valeur doit changer, les pages d'exploitation quand quelque chose va mal en production. Pour les contributions au code source et l'API, [Develop](/fr/develop/api-reference) est une section plus loin.

---
title: Tale auto-hébergé
description: Exploite Tale sur ton infrastructure — installe, configure, opère.
---

L'édition auto-hébergée de Tale tourne dans ton VPC, dans ton data center ou dans un environnement isolé du réseau (air-gap). Tu récupères la plateforme complète sous forme de bundle Docker Compose, que tu mets à jour avec une seule commande (`tale deploy`). Les certifications sont les mêmes qu'en Cloud — ISO 27001, SOC 2 Type II et conformité RGPD — mais l'exploitation t'appartient. Chaque fonctionnalité visible par l'utilisateur est identique à l'édition [Cloud](/fr/cloud) managée ; cette section couvre uniquement ce qui s'ajoute quand tu fais tourner ta propre instance.

Tout ce que Member, Editor, Developer ou Admin utilisent au quotidien — chat, base de connaissances, agents, automatisations, administration de l'organisation, permissions des rôles — vit dans [Platform](/fr/platform) et s'applique aux deux éditions. Cette section s'adresse à l'opérateur qui installe, met à jour, supervise et sauvegarde l'instance.

## Installer ton instance

Commence par l'[aperçu auto-hébergé](/fr/self-hosted/overview) pour l'architecture et les services, puis suis le [guide d'installation sur serveur Linux](/fr/self-hosted/install/linux-server) pas à pas. TLS, reverse-proxies et déploiements en sous-chemin y sont également traités.

## Configurer

- [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) — chaque variable lue par Tale, regroupée par service.
- [Rétention](/fr/self-hosted/configuration/retention) — règles de conservation des données, table par table.
- [Authentification](/fr/self-hosted/admin/authentication) — mot de passe, SSO (Microsoft Entra ID) ou en-têtes de confiance. Spécifique à l'auto-hébergement parce que piloté par des variables d'environnement.

## Opérer

- [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) — comment les services s'emboîtent.
- [Observabilité](/fr/self-hosted/operate/observability/operations) — métriques, journaux et sondes de santé.
- [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) — isoler un problème sur une instance en production.
- [Avis de sécurité](/fr/self-hosted/operate/security/advisories) — responsabilités de patch et suivi des CVE.
- [Notes de version](/fr/self-hosted/operate/release-notes/format) — comment lire les notes de version, avec des consignes d'upgrade par version.

## Fonctionnalités et administration

La documentation des fonctionnalités (chat, agents, automatisations, connaissances, intégrations) et toute l'administration de l'organisation (membres, rôles, équipes, image de marque, gouvernance, fournisseurs d'IA, analytique) se trouve dans [Platform](/fr/platform). Les guides par rôle destinés aux utilisateurs finaux y vivent également.

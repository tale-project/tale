---
title: Bienvenue sur Tale
description: Plateforme IA souveraine — chatte avec tes propres documents, crée des agents personnalisés, lance des automatisations et gère les conversations clients, sur du matériel que tu contrôles.
kind: index
---

Tale est une plateforme IA souveraine : chatte avec des modèles sur tes propres documents, crée des agents qui prennent un travail en charge de bout en bout, lance des automatisations multi-étapes en arrière-plan, et gère les conversations clients depuis une seule boîte de réception — avec ton choix de fournisseurs IA et tes données ancrées dans une région que tu contrôles. La plateforme existe en deux éditions, [Cloud](/fr/cloud) et [auto-hébergée](/fr/self-hosted), et chaque fonctionnalité, API et rôle est identique entre les deux. La seule différence : qui exploite la stack.

Cette page est la porte d'entrée pour les deux éditions et tous les rôles. Choisis l'édition qui correspond à la façon dont Tale sera hébergé, puis va dans la section indexée par ce que tu fais au quotidien. Si tu connais déjà ton édition et veux la référence des fonctionnalités, va directement sur [Platform](/fr/platform) — la documentation canonique de chaque fonctionnalité visible par l'utilisateur, identique entre les deux éditions.

## Choisis une édition

Les deux éditions échangent contrôle contre confort. Toutes deux livrent le même produit ; la différence porte sur qui exploite l'infrastructure.

- **[Cloud](/fr/cloud)** — Tale exploite la stack et ancre tes données en Suisse ou dans l'UE. Choisis-la quand souveraineté veut dire « juridiction UE » et non « derrière notre pare-feu », et quand l'équipe ne devrait pas passer ses heures à exploiter de l'infrastructure.
- **[Auto-hébergée](/fr/self-hosted)** — installe Tale dans ton propre VPC, sur du matériel sur site ou dans un environnement isolé du réseau avec une seule commande CLI. Choisis-la quand résidence des données veut dire « notre datacentre », quand les contrôles réseau doivent englober toute la stack, ou quand des modèles personnalisés et un build personnalisé sont non négociables.

## Choisis un rôle

Tale livre six rôles — Propriétaire, Admin, Développeur, Éditeur, Membre et Désactivé — chacun avec son propre jeu de permissions. La documentation indexée par rôle sous [Platform](/fr/platform) s'applique aux deux éditions.

- **[Membre](/fr/platform/member/overview)** — chatte avec les agents, parcours la base de connaissances, lis les conversations et les approbations qui te sont assignées.
- **[Éditeur](/fr/platform/editor/overview)** — entretiens la base de connaissances, gère la boîte de réception des conversations, approuve les exécutions de workflow, maintiens la bibliothèque de prompts.
- **[Développeur](/fr/platform/developer/overview)** — crée des agents, des automatisations et des intégrations ; gère les clés API, les webhooks et les entités de données structurées.
- **[Admin](/fr/platform/admin/overview)** — configure les membres et les rôles, les équipes, les fournisseurs IA, le branding, les politiques de gouvernance et le journal d'audit.

Si tu intègres Tale avec d'autres systèmes ou contribues au code source, [Develop](/fr/develop/api-reference) est la section à ouvrir — l'API REST, les webhooks, le SDK d'intégration et les workflows de contributeur vivent tous là.

## Ce qui distingue Tale

Quatre propriétés que la plupart des équipes comparent face aux alternatives :

- **Tes données, ta région.** Cloud ancre chaque locataire en Suisse ou dans l'UE, avec divulgation explicite des sous-traitants et l'option d'apporter tes propres clés IA. Auto-hébergée quitte le réseau entièrement — les prompts, le contenu des documents et les embeddings ne traversent jamais l'infrastructure de Tale.
- **N'importe quel modèle, échangeable par agent.** OpenAI, Anthropic, Google, Mistral, Meta, DeepSeek, Moonshot, Qwen — ou des modèles auto-hébergés via Ollama, vLLM ou LocalAI — échangeables agent par agent sans ré-indexation, sans ré-entraînement, sans migration.
- **Un produit pour toute l'organisation.** Six rôles couvrent les lecteurs en lecture seule jusqu'aux propriétaires d'organisation, organisés en équipes avec accès à la connaissance restreint. Les Membres chattent avec les agents ; les Éditeurs entretiennent ; les Développeurs construisent les automatisations ; les Admins gouvernent.
- **Une conformité que tu peux montrer à ton auditeur.** Certifié ISO 27001 et SOC 2, suisse (Ruler GmbH), aligné RGPD par défaut — avec journal d'audit et outillage pour les demandes de personnes concernées intégrés.

## Où ça s'inscrit

Le contrat de forme traite cet index comme une porte d'entrée, pas une visite guidée. Une fois l'édition et le rôle choisis, l'étape suivante utile est l'une des suivantes :

- [Platform](/fr/platform) — la référence canonique des fonctionnalités, identique entre les deux éditions. Démarre là une fois dans le produit.
- [Onboarding Cloud](/fr/cloud) ou [Installation auto-hébergée](/fr/self-hosted) — mise en place spécifique à l'édition. Passe-la si Tale tourne déjà pour toi.
- [Tutoriels](/fr/tutorials/overview) — exemples travaillés indexés par rôle, de bout en bout, sur une instance fraîche.

Pour le code source, les issues et les annonces de release, [GitHub](https://github.com/tale-project/tale) et [tale.dev](https://tale.dev) sont les canaux canoniques.

---
title: Fournisseurs IA
description: Connecte Tale aux modèles IA via des fournisseurs — des endpoints compatibles OpenAI gérés depuis l’UI Paramètres.
---

Tale parle aux modèles IA via des **fournisseurs** — chaque fournisseur est un endpoint d’API compatible OpenAI (OpenAI, OpenRouter, Anthropic via OpenRouter, Google, Ollama auto-hébergé, vLLM, etc.) assorti d’un catalogue de définitions de modèles. Un fournisseur expose _quels_ modèles existent et _comment_ ils peuvent être utilisés (chat, vision, embedding, génération d’images, transcription). Les admins gèrent les fournisseurs depuis **Paramètres > Fournisseurs IA** dans l’application ; les utilisateurs voient les modèles résultants dans le sélecteur de modèle du chat et dans la configuration des agents.

Tale est livré avec un fournisseur exemple [OpenRouter](https://openrouter.ai) qui donne accès à des modèles d’OpenAI, Anthropic, Google, Mistral, Meta et d’autres via une seule clé API — le chemin le plus rapide pour avoir un workspace de chat fonctionnel de bout en bout.

## Gérer les fournisseurs dans Paramètres

Ouvre **Paramètres > Fournisseurs IA**. Les admins peuvent :

- **Ajouter un fournisseur** avec un nom, un nom d’affichage, une base URL, une clé API et un ou plusieurs modèles. Chaque entrée de modèle porte un ID (doit correspondre à ce que l’endpoint accepte), un nom d’affichage, une description optionnelle et un ou plusieurs tags.
- **Modifier un fournisseur** pour mettre à jour son nom d’affichage, sa description, sa base URL, sa clé API, ses modèles par défaut par capability et son catalogue de modèles.
- **Supprimer un fournisseur** pour le retirer entièrement. Les agents qui référencent encore les modèles du fournisseur affichent un avertissement jusqu’à ce que tu choisisses un remplaçant.

La **description** affichée dans la liste des fournisseurs aide les utilisateurs à comprendre à quoi sert le fournisseur (p. ex. "OpenAI — Whisper pour le speech-to-text"). Les **modèles par défaut** par capability pré-sélectionnent celui utilisé pour chat, vision, embedding, génération d’images et transcription quand un utilisateur n’en choisit pas explicitement.

## Tags de modèle

Chaque modèle appartient à un ou plusieurs tags. Les tags contrôlent où le modèle apparaît dans le produit :

| Tag                | Où le modèle apparaît                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`             | Apparaît dans le sélecteur de modèle du chat et peut être référencé par les `supportedModels` des agents.                                 |
| `vision`           | Éligible pour les messages qui contiennent des pièces jointes image.                                                                      |
| `embedding`        | Utilisé par la [base de connaissances](/fr/platform/workspace/knowledge-base) pour la récupération de documents.                          |
| `image-generation` | Utilisé par les agents de génération d’images.                                                                                            |
| `image-edit`       | Utilisé par les agents d’édition d’images.                                                                                                |
| `transcription`    | Transcrit les uploads audio et vidéo du chat — voir [Pièces jointes du chat](/fr/platform/chat/attachments#transcription-audio-et-vidéo). |

Un même fournisseur peut mélanger des tags — un fournisseur OpenAI peut exposer des modèles `chat`, `vision` et `transcription` côte à côte.

## Rendre les modèles disponibles dans le chat

Les fournisseurs définissent quels modèles _existent_. Les agents définissent sur lesquels ils _peuvent tourner_. Ouvre l’agent dans **Agents > (nom de l’agent)** et ajoute les IDs de modèle à sa liste ; seuls les modèles présents dans au moins un fournisseur et listés sur l’agent apparaissent dans le sélecteur de modèle du chat.

L’agent de chat par défaut est préconfiguré avec les modèles exemple OpenRouter. Les agents personnalisés démarrent vides — choisis les modèles que tu veux que l’agent supporte. Pour le comportement du sélecteur quand deux fournisseurs définissent le même ID de modèle (et comment fonctionne l’épinglage), voir la référence fournisseurs sur disque ci-dessous.

## Instances self-hosted : configuration par fichiers

Les opérateurs self-hosted peuvent gérer les fournisseurs via des fichiers de config JSON en plus de l’UI — utile pour les workflows infrastructure-as-code, les modifications en masse ou les déploiements où l’UI n’est pas joignable. L’UI et les fichiers restent synchronisés ; enregistrer depuis **Paramètres > Fournisseurs IA** écrit le même JSON.

Pour le schéma de fichier, les fournisseurs exemple livrés, les secrets chiffrés par SOPS, les backends d'inférence auto-hébergés (Ollama, vLLM, LocalAI, faster-whisper-server), le réseau hôte Docker et la syntaxe d'épinglage de fournisseur, voir [Fournisseurs IA — référence de configuration](/fr/self-hosted/configuration/providers).

## Où cela s'insère

Les fournisseurs IA sont la porte entre Tale et les modèles IA avec lesquels le reste de l'organisation parle. Un agent choisit un préréglage de modèle (Rapide / Standard / Avancé) ; chaque préréglage pointe vers un modèle précis défini sur un fournisseur. Ajouter un fournisseur élargit le menu ; changer un défaut redirige tous les agents qui ne se sont pas explicitement liés à un modèle.

L'interface décrite ici est la même que celle utilisée par les admins Cloud ; les opérateurs auto-hébergés ont le choix entre l'UI et la forme fichier JSON documentée à [Fournisseurs IA — référence de configuration](/fr/self-hosted/configuration/providers). Une fois la liste des fournisseurs posée, les préréglages de modèle de chaque agent vivent sur l'agent lui-même — voir [Créer un agent](/fr/platform/agents/create).

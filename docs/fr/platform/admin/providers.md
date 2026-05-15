---
title: Fournisseurs IA
description: Connecte Tale aux modèles IA via des fournisseurs compatibles OpenAI — gère le catalogue depuis l'interface Paramètres, mélange API de vendeur, gateways et inférence auto-hébergée sous un même toit.
---

Tale parle aux modèles IA via des **fournisseurs** — chaque fournisseur est un endpoint d'API compatible OpenAI doublé d'un catalogue de définitions de modèles. L'endpoint peut être un vendeur hébergé (OpenAI, Anthropic via OpenRouter, Google), un gateway de routage (OpenRouter, Vercel AI Gateway), ou un serveur d'inférence auto-hébergé (Ollama, vLLM, LocalAI, faster-whisper-server). Un fournisseur expose _quels_ modèles existent et _comment_ ils peuvent être utilisés — chat, vision, embedding, génération d'image, édition d'image, transcription. Les Admins gèrent les fournisseurs depuis **Paramètres > Fournisseurs** ; les utilisateurs voient ensuite les modèles résultants dans le sélecteur de modèle de chat et dans la configuration d'agent.

Tale est livré avec un fournisseur d'exemple [OpenRouter](https://openrouter.ai) qui donne accès à des modèles d'OpenAI, Anthropic, Google, Mistral, Meta et d'autres via une seule clé API — le chemin le plus rapide d'une installation fraîche à un chat qui marche. Membres, Éditeurs et Développeurs ne peuvent pas modifier les fournisseurs ; l'écran est réservé à l'Admin.

## Gérer les fournisseurs dans Paramètres

Ouvre **Paramètres > Fournisseurs**. La vue liste permet aux Admins :

- **Ajouter un fournisseur** — ouvre la boîte de création. Nom, nom affiché, URL de base, clé API et un ou plusieurs modèles. Chaque modèle porte un ID (doit correspondre à ce que l'endpoint accepte), un nom affiché, une description optionnelle et un ou plusieurs tags.
- **Modifier un fournisseur** — réparti en **Modifier les détails** (nom affiché, description, URL de base), **Modifier les défauts** (le modèle par défaut par capacité — voir ci-dessous), la clé API et le catalogue de modèles.
- **Supprimer un fournisseur** — retire le fournisseur entièrement. Les agents qui référencent encore un de ses modèles font remonter un avertissement jusqu'à ce que l'agent soit redirigé.
- **Tester la connexion** — envoie une petite requête à chaque modèle du catalogue et rapporte la latence et la joignabilité par modèle. Sers-t'en après avoir tourné une clé API ou pointé l'URL de base sur un nouvel endpoint.

Le champ **Description** affiché dans la liste des fournisseurs est pour la consommation humaine — par exemple, `OpenAI — Whisper pour la transcription audio` rend le catalogue auto-explicite quand une équipe en mélange plusieurs. Les **Modèles par défaut** par capacité décident quel modèle est utilisé pour chat, vision, embedding, génération d'image, édition d'image et transcription quand un utilisateur ou un agent n'en choisit pas un explicitement.

## Tags de modèles

Chaque modèle appartient à un ou plusieurs tags. Le tag pilote où le modèle peut être choisi.

| Tag                | Où le modèle est proposé                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`             | Le sélecteur de modèle de chat et le `supportedModels` d'un agent.                                                                                       |
| `vision`           | Éligible pour les messages qui incluent des pièces jointes image.                                                                                        |
| `embedding`        | Utilisé par la [base de connaissances](/fr/platform/workspace/knowledge-base) pour la récupération de documents.                                         |
| `image-generation` | Utilisé par les agents de génération d'image (`/v1/images/generations` ou `/v1/chat/completions` avec des content-parts image, selon le mode du modèle). |
| `image-edit`       | Utilisé par les agents d'édition d'image.                                                                                                                |
| `transcription`    | Transcrit les téléversements audio et vidéo de chat — voir [Pièces jointes de chat](/fr/platform/chat/attachments#audio-and-video-transcription).        |

Un seul fournisseur peut mélanger les tags — un fournisseur OpenAI peut exposer des modèles `chat`, `vision` et `transcription` côte à côte. Les modèles sans tag sont invisibles au reste du produit, de sorte que le catalogue est opt-in par capacité.

## Comment les modèles atteignent le chat

Les fournisseurs définissent quels modèles _existent_. Les agents définissent sur quels modèles ils _peuvent tourner_. Ouvre l'agent dans **Agents > (nom de l'agent)** et ajoute des IDs de modèles à sa section **Modèle** ; seuls les modèles présents dans au moins un fournisseur _et_ listés sur l'agent apparaissent dans le sélecteur de modèle de chat. L'agent de chat par défaut est livré pré-configuré avec les modèles d'exemple OpenRouter ; les agents personnalisés démarrent vides, de sorte que le catalogue reste explicite.

Pour le comportement du sélecteur quand deux fournisseurs définissent le même ID de modèle, et pour la syntaxe d'épinglage qui laisse les agents préférer un fournisseur précis, voir la référence sur fichier liée plus bas.

## Options du fournisseur (avancé)

Le panneau **Options du fournisseur** transmet un objet JSON libre comme champs supplémentaires du corps de requête à chaque appel de modèle. Tale n'interprète pas le JSON — il le passe tel quel — donc la forme est dictée par l'API en amont. Gateways et vendeurs directs exposent des sortes de réglages différentes :

- **OpenRouter (gateway)** — contrôles de routage sous une clé `provider` de premier niveau :

  ```json
  { "provider": { "quantizations": ["fp8"], "allow_fallbacks": false } }
  ```

- **Vercel AI Gateway (gateway)** — route principalement via le préfixe d'ID de modèle et les en-têtes HTTP ; le passthrough côté corps est limité à des champs d'observabilité comme `metadata` :

  ```json
  { "metadata": { "tale_agent": "support" } }
  ```

- **OpenAI (direct)** — réglages de comportement du modèle au niveau du corps :

  ```json
  { "service_tier": "priority", "parallel_tool_calls": false }
  ```

- **Together AI (direct)** — réglages de modération et de décodage au niveau du corps :

  ```json
  { "safety_model": "meta-llama/Llama-Guard-4-12B", "repetition_penalty": 1.1 }
  ```

Les vendeurs directs n'exposent pas `quantizations` comme champ de requête — la précision est fixée au déploiement, donc choisis un autre ID de modèle. Des clés comme `model`, `messages`, `max_tokens` et `temperature` sont refusées à cette couche parce qu'elles appartiennent à l'agent, pas au fournisseur.

Le même panneau existe au niveau du modèle — le JSON au niveau du modèle est fusionné par-dessus les défauts au niveau du fournisseur, de sorte qu'un override par modèle ne demande pas de dupliquer l'objet partagé.

## Instances auto-hébergées : configuration en fichiers

Les opérateurs auto-hébergés peuvent gérer les fournisseurs via des fichiers de configuration JSON en plus de l'interface — utile pour les workflows infrastructure-as-code, les édits en masse ou les déploiements où l'interface n'est pas joignable. L'interface et les fichiers restent synchronisés ; enregistrer depuis **Paramètres > Fournisseurs** écrit le même JSON. Les secrets peuvent être chiffrés SOPS sur disque tout en restant éditables depuis l'interface.

Pour le schéma de fichier, les fournisseurs d'exemple embarqués, les backends d'inférence auto-hébergés (Ollama, vLLM, LocalAI, faster-whisper-server), le networking hôte Docker et la syntaxe d'épinglage de fournisseur, voir [Fournisseurs — Référence de configuration](/fr/self-hosted/configuration/providers).

## Où cela s'insère

Les fournisseurs sont la porte entre Tale et les modèles IA auxquels parle le reste de l'organisation. Un agent choisit un préréglage de modèle (Rapide, Standard, Avancé) ; chaque préréglage est lié à un modèle précis défini sur un fournisseur. Ajouter un fournisseur étend le menu ; changer un défaut redirige chaque agent qui n'a pas explicitement opté pour un modèle.

L'interface que cette page décrit est la même que celle qu'utilisent les Admins Cloud. Les opérateurs auto-hébergés ont le choix entre l'interface et la forme fichier JSON documentée à [Fournisseurs — Référence de configuration](/fr/self-hosted/configuration/providers). Une fois la liste des fournisseurs posée, les préréglages de modèles qu'utilise chaque agent vivent sur l'agent lui-même — voir [Créer un agent](/fr/platform/agents/create) pour la configuration côté agent.

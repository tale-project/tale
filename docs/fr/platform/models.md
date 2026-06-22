---
title: Modèles livrés en standard
description: Quels fournisseurs et modèles une instance Tale toute neuve embarque — OpenRouter couvre le chat, la vision, les embeddings, la voix et la génération d'images via une seule clé.
---

Une instance Tale toute neuve embarque un seul fournisseur configuré : **OpenRouter**, couvrant le chat, la vision, les embeddings, la reconnaissance vocale, la synthèse vocale et la génération d'images. Les agents par défaut dans `builtin-configs/agents/` puisent dans les modèles OpenRouter, et la plupart des équipes restent sur les défauts pendant des semaines avant d'en changer. Une clé, un rate-limit, une facture — et tu peux toujours ajouter un fournisseur direct (OpenAI, un serveur Ollama/vLLM local, un proxy Bedrock) dès qu'une charge de travail l'exige. Cette page liste ce qui est livré et renvoie vers le catalogue complet.

Les modèles dérivent plus vite que la doc. Les listes ci-dessous sont correctes au moment où `builtin-configs/providers/openrouter.json` a été écrit ; la vérité canonique, c'est le fichier JSON, et le « ce qui est joignable aujourd'hui » canonique est ce que montre la page **Paramètres > Providers** sur ton instance.

## Le fournisseur par défaut

| Fournisseur    | Rôle par défaut                                                                       | Pourquoi celui-ci                                                                                                                                                     | Documentation                                        |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **OpenRouter** | Chat, vision, embeddings, reconnaissance vocale, synthèse vocale, génération d'images | Une seule clé donne accès à des dizaines de modèles frontier et open-weight — plus des modèles audio et image — avec une tarification cohérente et un seul rate-limit | [openrouter.ai/models](https://openrouter.ai/models) |

OpenRouter est un endpoint compatible OpenAI que Tale appelle en HTTPS avec un bearer token. Tu peux le remplacer (ou ajouter d'autres fournisseurs à côté, y compris un serveur Ollama ou vLLM local) en éditant le JSON sous `TALE_CONFIG_DIR/<orgSlug>/providers/` de ton instance — sous le layout org-first, les catalogues de fournisseurs sont par-org (chaque org a son propre sous-arbre `providers/`).

## OpenRouter — chat, vision, embeddings

OpenRouter est une passerelle multi-modèles. La configuration livrée choisit `deepseek-v4-flash` comme modèle de chat par défaut, `qwen3-vl-32b-instruct` pour la vision et `qwen3-embedding-8b` pour les embeddings — tous choisis pour le rapport vitesse/qualité au moment de l'écriture. La liste complète ci-dessous reprend chaque modèle visible de la `openrouter.json` livrée, régénérée par le job de catalogue hebdomadaire pour qu'elle ne dérive jamais de la configuration :

<!-- MODELS_TABLE:START -->

<!-- Auto-generated from builtin-configs/providers/openrouter.json by the weekly model-catalog sync. Do not edit by hand. -->

| Fournisseur       | Modèle                               | Capacités                    | Contexte | Entrée ($/M) | Sortie ($/M) |
| ----------------- | ------------------------------------ | ---------------------------- | -------- | ------------ | ------------ |
| AI21              | Jamba Large 1.7                      | chat                         | 256K     | 2.00         | 8.00         |
| Amazon            | Nova Premier                         | chat, vision                 | 1M       | 2.50         | 12.50        |
| Amazon            | Nova 2 Lite                          | chat, vision                 | 1M       | 0.30         | 2.50         |
| Anthropic         | Claude Sonnet 4.6                    | chat, vision                 | 1M       | 3.00         | 15.00        |
| Anthropic         | Claude Haiku 4.5                     | chat                         | 200K     | 1.00         | 5.00         |
| Anthropic         | Claude Opus 4.8                      | chat, vision                 | 1M       | 5.00         | 25.00        |
| Black Forest Labs | FLUX.2 [flex]                        | image-generation, image-edit | —        | —            | —            |
| Black Forest Labs | FLUX.2 [max]                         | image-generation, image-edit | —        | —            | —            |
| Black Forest Labs | FLUX.2 [pro]                         | image-generation, image-edit | —        | —            | —            |
| Cohere            | Command A                            | chat                         | 256K     | 2.50         | 10.00        |
| Cohere            | Command R                            | chat                         | 128K     | 0.15         | 0.60         |
| DeepSeek          | DeepSeek V4 Pro                      | chat                         | 1M       | 0.43         | 0.87         |
| DeepSeek          | DeepSeek V4 Flash                    | chat                         | 1M       | 0.09         | 0.18         |
| Google            | Gemini 3 Pro                         | chat, vision                 | 1M       | 2.00         | 12.00        |
| Google            | Gemini 3 Flash                       | chat, vision                 | 1M       | 0.50         | 3.00         |
| Google            | Gemma 4 31B IT                       | chat, vision                 | 262K     | 0.12         | 0.35         |
| Google            | Gemma 4 26B A4B IT                   | chat, vision                 | 262K     | 0.06         | 0.33         |
| Google            | Nano Banana (Gemini 2.5 Flash Image) | image-generation, image-edit | 33K      | 0.30         | 2.50         |
| Liquid            | LFM2 24B                             | chat                         | 128K     | 0.03         | 0.12         |
| Meta              | LLaMA 4 Maverick                     | chat                         | 1M       | 0.15         | 0.60         |
| Meta              | LLaMA 4 Scout                        | chat                         | 10M      | 0.10         | 0.30         |
| Microsoft         | Phi-4                                | chat                         | 16K      | 0.07         | 0.14         |
| MiniMax           | MiniMax M3                           | chat, vision                 | 1M       | 0.30         | 1.20         |
| Mistral           | Mistral Large 3                      | chat                         | 262K     | 0.50         | 1.50         |
| Mistral           | Mistral Medium 3.5                   | chat, vision                 | 262K     | 1.50         | 7.50         |
| Moonshot AI       | Kimi K2.6                            | chat, vision                 | 262K     | 0.68         | 3.41         |
| Moonshot AI       | Kimi K2.7 Code                       | chat, vision                 | 262K     | 0.61         | 3.07         |
| NVIDIA            | Nemotron 3 Ultra                     | chat                         | 1M       | 0.50         | 2.20         |
| NVIDIA            | Nemotron 3 Super                     | chat                         | 1M       | 0.09         | 0.45         |
| OpenAI            | GPT-OSS 120B                         | chat                         | 131K     | 0.04         | 0.18         |
| OpenAI            | GPT-4o mini TTS                      | text-to-speech               | —        | —            | —            |
| OpenAI            | GPT-5.3 Chat                         | chat, vision                 | 128K     | 1.75         | 14.00        |
| OpenAI            | GPT-5.5                              | chat, vision                 | 1M       | 5.00         | 30.00        |
| OpenAI            | GPT-5.5 Pro                          | chat, vision                 | 1M       | 30.00        | 180.00       |
| OpenAI            | Whisper v1                           | transcription                | —        | —            | —            |
| Perplexity        | Sonar Pro                            | chat, vision                 | 200K     | 3.00         | 15.00        |
| Perplexity        | Sonar                                | chat, vision                 | 127K     | 1.00         | 1.00         |
| Qwen              | Qwen3.6 Max Preview                  | chat                         | 262K     | 1.04         | 6.24         |
| Qwen              | Qwen3 Coder 480B                     | chat                         | 1M       | 0.22         | 1.80         |
| Qwen              | Qwen3 VL 32B                         | chat, vision                 | 262K     | 0.10         | 0.42         |
| Qwen              | Qwen3.6 Flash                        | chat, vision                 | 1M       | 0.19         | 1.13         |
| Qwen              | Qwen3 Embedding 8B                   | embedding                    | —        | 0.01         | 0.00         |
| Qwen              | Qwen3.7 Plus                         | chat, vision                 | 1M       | 0.32         | 1.28         |
| Reka              | Reka Flash 3                         | chat                         | 66K      | 0.10         | 0.20         |
| Xiaomi            | MiMo V2.5 Pro                        | chat                         | 1M       | 0.43         | 0.87         |
| Z.AI              | GLM 5.1                              | chat                         | 203K     | 0.98         | 3.08         |
| Z.AI              | GLM 5 Turbo                          | chat                         | 262K     | 1.20         | 4.00         |
| Z.AI              | GLM 5V Turbo                         | chat, vision                 | 131K     | 1.20         | 4.00         |
| xAI               | Grok 4.20                            | chat, vision                 | 2M       | 1.25         | 2.50         |

<!-- MODELS_TABLE:END -->

Le catalogue complet et à jour vit sur [openrouter.ai/models](https://openrouter.ai/models). Tout modèle exposé par OpenRouter peut être ajouté à ton instance en éditant le tableau `models` dans `<orgSlug>/providers/openrouter.json` sous `TALE_CONFIG_DIR` (par-org sous le layout org-first).

## OpenRouter — reconnaissance et synthèse vocales

La même clé OpenRouter couvre la boucle audio dont le [mode vocal](/fr/platform/chat/voice-mode) a besoin :

- **openai/whisper-1** — reconnaissance vocale. Le fournisseur de transcription chaque fois qu'un utilisateur enregistre un message. La configuration livrée définit `transcriptionMode: "json-base64"`, ce qui sélectionne le format de transcription audio d'OpenRouter.
- **openai/gpt-4o-mini-tts-2025-12-15** — synthèse vocale. Le fournisseur de voix par défaut pour les réponses d'agent lues en audio, avec des voix mappées par locale.

Les versions de modèles TTS sont datées et changent, donc confirme le slug actuel dans les collections **Speech-to-Text** et **Text-to-Speech** sur [openrouter.ai/models](https://openrouter.ai/models) et mets à jour l'`id` plus l'entrée `defaults` correspondante ensemble s'il change. Tu préfères appeler Whisper ou gpt-4o-mini-tts directement contre OpenAI ? Ajoute un fournisseur `openai.json` pointant vers `https://api.openai.com/v1` et laisse `transcriptionMode` non défini (le format `multipart` par défaut est ce qu'OpenAI attend).

## OpenRouter — génération d'images

La génération et l'édition d'images passent par le chemin multimodal `/chat/completions` d'OpenRouter. Le modèle image par défaut est FLUX.2 [pro] ; la liste livrée :

- **Black Forest Labs** — FLUX.2 [max], FLUX.2 [pro], FLUX.2 [flex] — chacun génère et édite des images (image de référence).
- **Google** — Nano Banana (Gemini 2.5 Flash Image) — génération plus édition par image de référence.

Le catalogue plus large vit sur [openrouter.ai/models](https://openrouter.ai/models) (collection Image).

## Échanger ou ajouter des fournisseurs

OpenRouter est le défaut, pas une obligation. Remplace-le par un autre endpoint compatible OpenAI, ou ajoute d'autres fournisseurs à côté, en éditant le JSON dans `TALE_CONFIG_DIR/<orgSlug>/providers/` — pointe un fichier vers ton API, définis son tableau `models`, et Tale recharge au prochain démarrage. Une instance Ollama locale, un cluster vLLM privé, un contrat OpenAI direct, ou un proxy Bedrock entrent tous dans la même forme. La mécanique vit sous [Configuration → providers](/fr/self-hosted/configuration/providers) ; le formulaire UI admin pour la même configuration est sur [Providers](/fr/platform/admin/providers).

## Où ça s'inscrit

Les modèles sont la couche en dessous de chaque agent, chaque réponse de chat, chaque sortie vocale et chaque image que la plateforme produit. La lecture suivante dépend de pourquoi tu es venu — [Concepts d'agent](/fr/platform/agents/concepts) parcourt comment un modèle se lie aux trois autres boutons d'un agent, et [Mode Arène](/fr/platform/chat/arena-mode) est le workflow pour choisir un défaut quand plus d'un modèle pourrait faire le travail.

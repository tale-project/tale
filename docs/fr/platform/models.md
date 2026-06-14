---
title: Modèles livrés en standard
description: Quels fournisseurs et modèles une instance Tale toute neuve embarque — OpenRouter couvre le chat, la vision, les embeddings, la voix et la génération d'images via une seule clé.
---

Une instance Tale toute neuve embarque un seul fournisseur configuré : **OpenRouter**, couvrant le chat, la vision, les embeddings, la reconnaissance vocale, la synthèse vocale et la génération d'images. Les agents par défaut dans `examples/default/agents/` puisent dans les modèles OpenRouter, et la plupart des équipes restent sur les défauts pendant des semaines avant d'en changer. Une clé, un rate-limit, une facture — et tu peux toujours ajouter un fournisseur direct (OpenAI, un serveur Ollama/vLLM local, un proxy Bedrock) dès qu'une charge de travail l'exige. Cette page liste ce qui est livré et renvoie vers le catalogue complet.

Les modèles dérivent plus vite que la doc. Les listes ci-dessous sont correctes au moment où `examples/default/providers/openrouter.json` a été écrit ; la vérité canonique, c'est le fichier JSON, et le « ce qui est joignable aujourd'hui » canonique est ce que montre la page **Paramètres > Providers** sur ton instance.

## Le fournisseur par défaut

| Fournisseur    | Rôle par défaut                                                                       | Pourquoi celui-ci                                                                                                                                                     | Documentation                                        |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **OpenRouter** | Chat, vision, embeddings, reconnaissance vocale, synthèse vocale, génération d'images | Une seule clé donne accès à des dizaines de modèles frontier et open-weight — plus des modèles audio et image — avec une tarification cohérente et un seul rate-limit | [openrouter.ai/models](https://openrouter.ai/models) |

OpenRouter est un endpoint compatible OpenAI que Tale appelle en HTTPS avec un bearer token. Tu peux le remplacer (ou ajouter d'autres fournisseurs à côté, y compris un serveur Ollama ou vLLM local) en éditant le JSON sous `TALE_CONFIG_DIR/<orgSlug>/providers/` de ton instance — sous le layout org-first, les catalogues de fournisseurs sont par-org (chaque org a son propre sous-arbre `providers/`).

## OpenRouter — chat, vision, embeddings

OpenRouter est une passerelle multi-modèles. La configuration livrée choisit `deepseek-v4-flash` comme modèle de chat par défaut, `qwen3-vl-32b-instruct` pour la vision et `qwen3-embedding-8b` pour les embeddings — tous choisis pour le rapport vitesse/qualité au moment de l'écriture. La liste complète livrée :

- **Anthropic** — Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5.
- **OpenAI** — GPT-5.2 Pro, GPT-5.2, GPT-5.2 Instant, GPT-OSS 120B (la version open-weight).
- **Google** — Gemini 3 Pro, Gemini 3 Flash, Gemma 4 31B IT, Gemma 4 26B A4B IT, Nano Banana (Gemini 2.5 Flash Image).
- **DeepSeek** — DeepSeek V4 Pro, DeepSeek V4 Flash.
- **Moonshot AI** — Kimi K2.6, Kimi K2.5.
- **MiniMax** — MiniMax M2.7.
- **NVIDIA** — Nemotron 3 Super 120B.
- **Qwen** — Qwen3.6 Max Preview, Qwen3.6 Plus, Qwen3.6 Flash, Qwen3.6 35B A3B, Qwen3.5 397B A17B, Qwen3 Coder 480B, Qwen3 235B A22B, Qwen3 VL 32B, Qwen3 Embedding 8B.
- **Z.AI** — GLM 5.1, GLM 5 Turbo, GLM 5V Turbo.
- **Mistral** — Mistral Large 3, Mistral Medium 3.
- **Xiaomi** — MiMo V2.5 Pro.
- **Meta** — LLaMA 4 Maverick, LLaMA 4 Scout.
- **Black Forest Labs** — FLUX.2 [max], FLUX.2 [pro], FLUX.2 [flex].

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

---
title: Modèles livrés en standard
description: Quels fournisseurs et modèles une instance Tale toute neuve embarque — OpenRouter pour le chat et la vision, OpenAI pour la voix, Vercel AI Gateway pour la génération d'images.
---

Une instance Tale toute neuve embarque trois fournisseurs configurés : OpenRouter pour le chat, la vision et les embeddings ; OpenAI pour la reconnaissance et la synthèse vocales ; Vercel AI Gateway pour la génération d'images. Les agents par défaut dans `examples/agents/` puisent dans l'un de ces trois seaux, et la plupart des équipes restent sur les défauts pendant des semaines avant d'en changer. Cette page liste ce qui est livré et renvoie vers le catalogue complet de chaque fournisseur.

Les modèles dérivent plus vite que la doc. Les listes ci-dessous sont correctes au moment où `examples/providers/*.json` a été écrit ; la vérité canonique, ce sont les fichiers JSON, et le « ce qui est joignable aujourd'hui » canonique est ce que montre la page **Paramètres > Providers** sur ton instance.

## Les trois fournisseurs

| Fournisseur           | Rôle par défaut                    | Pourquoi celui-ci                                                                                                                 | Documentation                                                                  |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **OpenRouter**        | Chat, vision, embeddings           | Une seule clé donne accès à des dizaines de modèles frontier et open-weight avec une tarification cohérente et un seul rate-limit | [openrouter.ai/models](https://openrouter.ai/models)                           |
| **OpenAI**            | Reconnaissance et synthèse vocales | Whisper est la baseline pratique pour la transcription ; gpt-4o-mini-tts est le TTS fiable le moins cher                          | [platform.openai.com/docs/models](https://platform.openai.com/docs/models)     |
| **Vercel AI Gateway** | Génération d'images                | Un seul endpoint compatible OpenAI couvre FLUX, Imagen et Nano Banana sans clé par fournisseur                                    | [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models) |

Chaque fournisseur ci-dessus est un endpoint compatible OpenAI que Tale appelle en HTTPS avec un bearer token. Tu peux remplacer chacun par un autre fournisseur (y compris un serveur Ollama ou vLLM local) en éditant le JSON correspondant sous `TALE_CONFIG_DIR/providers/` de ton instance.

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

Le catalogue complet et à jour vit sur [openrouter.ai/models](https://openrouter.ai/models). Tout modèle exposé par OpenRouter peut être ajouté à ton instance en éditant le tableau `models` dans `providers/openrouter.json` sous `TALE_CONFIG_DIR`.

## OpenAI — reconnaissance et synthèse vocales

La configuration OpenAI livrée est volontairement étroite — voix uniquement. Les deux modèles couvrent la boucle dont le [mode vocal](/fr/platform/chat/voice-mode) a besoin :

- **whisper-1** — reconnaissance vocale. Le fournisseur de transcription chaque fois qu'un utilisateur enregistre un message.
- **gpt-4o-mini-tts** — synthèse vocale. Le fournisseur de voix par défaut pour les réponses d'agent lues en audio.

Ajoute des modèles chat et vision à la configuration OpenAI si tu veux les appeler directement sans passer par OpenRouter — utile pour les équipes déjà sur un contrat OpenAI Enterprise. La liste complète des modèles vit sur [platform.openai.com/docs/models](https://platform.openai.com/docs/models).

## Vercel AI Gateway — génération d'images

Le Vercel AI Gateway expose les endpoints de génération d'images de plusieurs éditeurs derrière une seule URL compatible OpenAI. Le modèle image par défaut est FLUX.2 [pro] ; la liste livrée :

- **Black Forest Labs** — FLUX 2 [pro], FLUX 1.1 [pro] Ultra, FLUX.1 Kontext Pro, FLUX.1 Kontext Max.
- **Google** — Imagen 4, Imagen 4 Fast, Imagen 4 Ultra, Nano Banana (Gemini 2.5 Flash Image).

Le catalogue plus large vit sur [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models).

## Échanger ou ajouter des fournisseurs

Les trois fournisseurs ci-dessus sont des défauts, pas des obligations. Remplace chacun par un autre endpoint compatible OpenAI en éditant le JSON dans `TALE_CONFIG_DIR/providers/` — pointe-le vers ton API, change le tableau `models`, et Tale recharge au prochain démarrage. Une instance Ollama locale, un cluster vLLM privé, ou un proxy Bedrock entrent tous dans la même forme. La mécanique vit sous [Configuration → providers](/fr/self-hosted/configuration/providers) ; le formulaire UI admin pour la même configuration est sur [Providers](/fr/platform/admin/providers).

## Où ça s'inscrit

Les modèles sont la couche en dessous de chaque agent, chaque réponse de chat, chaque sortie vocale et chaque image que la plateforme produit. La lecture suivante dépend de pourquoi tu es venu — [Concepts d'agent](/fr/platform/agents/concepts) parcourt comment un modèle se lie aux trois autres boutons d'un agent, et [Mode Arène](/fr/platform/chat/arena-mode) est le workflow pour choisir un défaut quand plus d'un modèle pourrait faire le travail.

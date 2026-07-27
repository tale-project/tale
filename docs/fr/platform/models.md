---
title: Catalogue de modèles
description: Le catalogue de modèles derrière chaque sélecteur dans Tale — où il vit sous Paramètres > Providers, ce que veulent dire les étiquettes de capacité, quels défauts sont livrés et comment la liste reste à jour.
---

Chaque sélecteur de modèle dans Tale — le menu de modèle du chat, la liaison de modèle d’un agent, les défauts qu’utilisent les services de crawl et de RAG — puise dans un seul catalogue : les modèles déclarés sur les fournisseurs d’IA de ton organisation. Une instance toute neuve embarque un seul fournisseur, **OpenRouter**, dont l’unique clé couvre le chat, la vision, les embeddings, la transcription, la synthèse vocale et la génération d’images. Cette page est la référence pour savoir où vit ce catalogue dans l’UI, ce que veulent dire les étiquettes sur chaque modèle, et ce qui est livré en standard.

<Frame caption="La liste de modèles du tiroir fournisseur — chaque modèle porte les étiquettes de capacité qui décident dans quels sélecteurs il apparaît.">

![Le tiroir de détails du fournisseur sous Paramètres > Providers, montrant une liste de modèles cherchable où chaque ligne porte des étiquettes de capacité comme Chat et Génération d’images, avec les actions Récupérer les modèles, Synchroniser depuis le catalogue et Ajouter un modèle au-dessus.](/images/platform/settings-provider-models.webp)

</Frame>

## Où vit le catalogue

Ouvre **Paramètres > Providers** et clique sur une ligne de fournisseur. Le tiroir liste tout ce que le fournisseur déclare : son URL de base et sa clé API, ses **Modèles par défaut**, et la liste **Modèles** elle-même — cherchable, avec **Afficher plus** après les dix premiers. **Ajouter un modèle** déclare une nouvelle entrée à la main ; **Récupérer les modèles** tire la liste que l’API du fournisseur rapporte. Les modèles qu’un admin marque **Masqué des sélecteurs de modèles** restent résolvables pour les liaisons existantes mais cessent d’apparaître dans les menus — c’est ainsi que les versions supplantées prennent leur retraite sans casser les anciens agents.

Chaque modèle porte une ou plusieurs étiquettes de capacité : **Chat**, **Vision**, **Embedding**, **Transcription**, **Synthèse vocale**, **Génération d'images**, **Édition d'images**. Les étiquettes sont porteuses — elles décident dans quels sélecteurs un modèle apparaît et quelle capacité de la plateforme a le droit de l’appeler. Un modèle sans étiquette correspondante n’apparaît jamais là où cette capacité est requise.

## Les défauts livrés

La carte **Modèles par défaut** nomme quel modèle chaque capacité d’arrière-plan utilise quand rien de plus spécifique n’est lié :

| Capacité            | Défaut livré       |
| ------------------- | ------------------ |
| Chat                | DeepSeek V4 Flash  |
| Vision              | Qwen3 VL 32B       |
| Embedding           | Qwen3 Embedding 8B |
| Génération d’images | FLUX.2 [pro]       |
| Transcription       | Whisper v1         |

La synthèse vocale pour le [mode vocal](/fr/platform/chat/voice-mode) est livrée via le GPT-4o mini TTS d’OpenAI à travers la même clé OpenRouter, et la [génération d’images](/fr/platform/agents/image-generation) retombe sur FLUX.2 [pro].

## Comment la liste reste à jour

Les modèles dérivent plus vite que la doc. Deux mécanismes sur la page **Providers** gardent le catalogue à jour : la carte **Catalogue de modèles** rafraîchit les capacités des modèles — tarification, fenêtre de contexte, raisonnement, vision — depuis le catalogue public d’OpenRouter chaque jour, et la bascule **Auto-sync hebdomadaire de la config fournisseur** fusionne les nouvelles versions phares une fois par semaine dans la config fournisseur de l’org, masque les versions supplantées et laisse intact tout champ que tu as personnalisé.

La liste livrée ci-dessous est régénérée depuis la même source, elle correspond donc à ce que voit une instance toute neuve :

<!-- MODELS_TABLE:START -->

<!-- Auto-generated from builtin-configs/providers/openrouter.json by the weekly model-catalog sync. Do not edit by hand. -->

| Fournisseur | Modèle | Capacités | Contexte | Entrée ($/M) | Sortie ($/M) |
| --- | --- | --- | --- | --- | --- |
| AI21 | Jamba Large 1.7 | chat | 256K | 2.00 | 8.00 |
| Amazon | Nova Premier | chat, vision | 1M | 2.50 | 12.50 |
| Amazon | Nova 2 Lite | chat, vision | 1M | 0.30 | 2.50 |
| Anthropic | Claude Fable (latest) | chat, vision | 1M | 10.00 | 50.00 |
| Anthropic | Claude Fable 5 | chat, vision | 1M | 10.00 | 50.00 |
| Anthropic | Claude Haiku 4.5 | chat | 200K | 1.00 | 5.00 |
| Anthropic | Anthropic: Claude Sonnet 5 | chat, vision | 1M | 2.00 | 10.00 |
| Anthropic | Claude Opus 5 | chat, vision | 1M | 5.00 | 25.00 |
| Black Forest Labs | FLUX.2 [flex] | image-generation, image-edit | — | — | — |
| Black Forest Labs | FLUX.2 [max] | image-generation, image-edit | — | — | — |
| Black Forest Labs | FLUX.2 [pro] | image-generation, image-edit | — | — | — |
| Cohere | Command A | chat | 256K | 2.50 | 10.00 |
| Cohere | Command R | chat | 128K | 0.15 | 0.60 |
| DeepSeek | DeepSeek V4 Pro | chat | 1M | 0.43 | 0.87 |
| DeepSeek | DeepSeek V4 Flash | chat | 1M | 0.14 | 0.28 |
| Google | Gemini 3 Pro | chat, vision | 1M | 2.00 | 12.00 |
| Google | Gemini 3 Flash | chat, vision | 1M | 0.50 | 3.00 |
| Google | Gemma 4 31B IT | chat, vision | 262K | 0.14 | 0.40 |
| Google | Gemma 4 26B A4B IT | chat, vision | 262K | 0.12 | 0.35 |
| Google | Nano Banana (Gemini 2.5 Flash Image) | image-generation, image-edit | 33K | 0.30 | 2.50 |
| Liquid | LFM2 24B | chat | 128K | 0.03 | 0.12 |
| Meta | LLaMA 4 Maverick | chat | 1M | 0.20 | 0.80 |
| Meta | LLaMA 4 Scout | chat | 1M | 0.10 | 0.30 |
| Microsoft | Phi-4 | chat | 16K | 0.07 | 0.14 |
| MiniMax | MiniMax M3 | chat, vision | 1M | 0.30 | 1.20 |
| Mistral | Mistral Large 3 | chat | 262K | 0.50 | 1.50 |
| Mistral | Mistral Medium 3.5 | chat, vision | 262K | 1.50 | 7.50 |
| Moonshot AI | Kimi K2.7 Code | chat, vision | 262K | 0.73 | 3.50 |
| Moonshot AI | MoonshotAI: Kimi K3 | chat, vision | 1M | 3.00 | 15.00 |
| NVIDIA | Nemotron 3 Ultra | chat | 512K | 0.50 | 2.20 |
| NVIDIA | Nemotron 3 Super | chat | 1M | 0.09 | 0.40 |
| OpenAI | GPT-OSS 120B | chat | 131K | 0.04 | 0.17 |
| OpenAI | GPT-4o mini TTS | text-to-speech | — | — | — |
| OpenAI | GPT-5.3 Chat | chat, vision | 128K | 1.75 | 14.00 |
| OpenAI | GPT-5.5 | chat, vision | 1M | 5.00 | 30.00 |
| OpenAI | GPT-5.5 Pro | chat, vision | 1M | 30.00 | 180.00 |
| OpenAI | Whisper v1 | transcription | — | — | — |
| Perplexity | Sonar Pro | chat, vision | 200K | 3.00 | 15.00 |
| Perplexity | Sonar | chat, vision | 127K | 1.00 | 1.00 |
| Qwen | Qwen3.6 Max Preview | chat | 262K | 1.04 | 6.24 |
| Qwen | Qwen3 Coder 480B | chat | 262K | 0.30 | 1.00 |
| Qwen | Qwen3 VL 32B | chat, vision | 131K | 0.10 | 0.42 |
| Qwen | Qwen3.6 Flash | chat, vision | 1M | 0.19 | 1.13 |
| Qwen | Qwen3 Embedding 8B | embedding | — | 0.01 | 0.00 |
| Qwen | Qwen3.7 Plus | chat, vision | 1M | 0.32 | 1.28 |
| Reka | Reka Flash 3 | chat | 66K | 0.10 | 0.20 |
| Xiaomi | MiMo V2.5 Pro | chat | 1M | 0.43 | 0.87 |
| Z.AI | GLM 5.2 | chat | 1M | 0.82 | 2.57 |
| Z.AI | GLM 5 Turbo | chat | 203K | 1.20 | 4.00 |
| Z.AI | GLM 5V Turbo | chat, vision | 203K | 1.20 | 4.00 |
| xAI | Grok 4.20 | chat, vision | 2M | 1.25 | 2.50 |

<!-- MODELS_TABLE:END -->

Le catalogue complet et en direct vit sur [openrouter.ai/models](https://openrouter.ai/models) ; n’importe quel modèle qu’OpenRouter expose peut être ajouté à ton instance depuis le même tiroir.

## Où cela s’inscrit

Les modèles sont la couche sous chaque agent, chaque réponse de chat, chaque sortie vocale et chaque image que la plateforme rend. OpenRouter est le défaut, pas une obligation — ajouter un fournisseur direct, un serveur Ollama ou vLLM local, ou une seconde passerelle est du travail d’admin couvert par [Providers](/fr/platform/admin/providers), et la forme basée fichier de la même configuration vit sous [Configuration → providers](/fr/self-hosted/configuration/providers). Pour choisir entre des modèles de chat quand plus d’un pourrait faire le travail, [Mode arène](/fr/platform/chat/arena-mode) est le workflow bâti exactement pour cette question.

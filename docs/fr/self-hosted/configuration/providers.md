---
title: Fournisseurs IA
description: Configure des fournisseurs de modèles IA via des fichiers JSON, connecte des backends d’inférence auto-hébergés et stocke les secrets soit chiffrés (SOPS) soit en clair.
---

Les fournisseurs relient Tale aux modèles IA via des API HTTP compatibles OpenAI. Les admins peuvent ajouter et modifier des fournisseurs depuis **Paramètres > Fournisseurs IA** dans l’application — voir [Fournisseurs IA](/fr/platform/admin/providers) pour le parcours UI et le concept. Cette page couvre la forme fichier : les JSON dans `TALE_CONFIG_DIR/providers/`, leur schéma, le stockage des secrets (chiffrés par SOPS ou en clair) et comment pointer Tale vers des backends d’inférence auto-hébergés comme Ollama, vLLM, LocalAI ou faster-whisper-server.

La forme UI et la forme fichier sont équivalentes — l’application écrit le même JSON quand tu enregistres depuis **Paramètres > Fournisseurs IA**. Choisis ce qui convient à ton workflow de change-management : les modifications UI vont plus vite au quotidien, les modifications fichier se committent proprement dans Git et conviennent aux opérateurs en infrastructure-as-code.

## Disposition des fichiers

La configuration des fournisseurs vit dans le sous-répertoire `providers/` de `TALE_CONFIG_DIR`. Voir la [référence d’environnement](/fr/self-hosted/configuration/environment-reference) pour la valeur de la variable selon le type de déploiement.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # API key — never commit (encrypted or plaintext)
    openai.json
    openai.secrets.json
```

- `providers/<name>.json` — config publique : base URL, définitions de modèles, tags, valeurs par défaut.
- `providers/<name>.secrets.json` — la clé API. Chiffrée par SOPS quand `SOPS_AGE_KEY` est défini, sinon JSON en clair en mode `0600`. Ne committe jamais — `tale init` ajoute `**/*.secrets.json` au `.gitignore` du projet.

La racine du nom de fichier (`<name>`) est le slug interne du fournisseur. Elle doit correspondre entre le fichier public et son jumeau secrets.

## Schéma de la config publique

```json
{
  "displayName": "OpenAI",
  "description": "OpenAI API (Whisper for speech-to-text).",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "chat": "gpt-4o",
    "transcription": "whisper-1"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "description": "Speech-to-text. Billed per minute of audio; 25 MB file ceiling.",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

| Champ            | Rôle                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`    | Libellé affiché dans l’UI et les sélecteurs de modèle.                                                                                                          |
| `description`    | Explication optionnelle affichée dans la liste des fournisseurs.                                                                                                |
| `baseUrl`        | Endpoint compatible OpenAI. `/chat/completions`, `/embeddings`, `/audio/transcriptions`, etc. sont ajoutés par Tale.                                            |
| `defaults`       | Modèle par défaut par capability quand aucun choix explicite n’existe. Clés : `chat`, `vision`, `embedding`, `image-generation`, `transcription`.               |
| `models[*].id`   | Doit correspondre exactement au nom de modèle accepté par l’endpoint (p. ex. `llama3.3` pour Ollama, `Systran/faster-whisper-base` pour faster-whisper-server). |
| `models[*].tags` | Un ou plusieurs parmi `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription` — contrôle où le modèle apparaît.                        |
| `models[*].cost` | Tarification optionnelle — voir le tableau des coûts ci-dessous.                                                                                                |

### Champs de coût

Les tarifs sont déclarés par modèle pour que le registre d’usage puisse estimer les coûts. Les modèles facturés au token et ceux facturés à l’unité utilisent des champs différents :

| Champ                   | S’applique à                     | Notes                                                                   |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `inputCentsPerMillion`  | Chat, vision, embedding          | Prix par million de tokens en entrée.                                   |
| `outputCentsPerMillion` | Chat, vision                     | Prix par million de tokens en sortie.                                   |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Prix fixe par image générée. Contourne le calcul par tokens.            |
| `centsPerAudioMinute`   | `transcription`                  | Prix par minute d’audio. OpenAI Whisper est à `0.6` (soit 0,006 $/min). |

Laisse `cost` vide pour les backends auto-hébergés où la dépense est opérationnelle plutôt que par appel — l’usage reste journalisé, mais la colonne coût estimé vaut `0`.

### Options du fournisseur (avancé)

Tale transmet des champs de corps de requête arbitraires spécifiques au fournisseur via un bloc `providerOptions` optionnel — disponible **à la fois** au niveau du fournisseur et par modèle. L’usage le plus courant est le [routage de fournisseur](https://openrouter.ai/docs/guides/routing/provider-selection) d’OpenRouter — épingler la quantisation, les fournisseurs autorisés, la politique de repli, etc.

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "z-ai/glm-5.1",
      "displayName": "GLM 5.1",
      "tags": ["chat"],
      "providerOptions": {
        "provider": { "quantizations": ["fp8"] }
      }
    }
  ]
}
```

**Règles d’écriture :**

- Écris la forme **interne** du corps de requête — Tale la namespace au moment de l’appel sous le nom réel du fournisseur. Ne **pas** envelopper dans `{ "openrouter": { ... } }`.
- **Précédence de fusion** : niveau fournisseur → niveau modèle (profondeur 2 : les clés top-level partagées fusionnent, sous-clés avec victoire du modèle, les tableaux remplacent intégralement).
- Le tableau de bord expose le même JSON via les panneaux **Avancé — Options du fournisseur** sous _Paramètres → Fournisseurs → \[fournisseur\]_ (niveau fournisseur) et la boîte de dialogue d’ajout/édition de modèle (par modèle).

**Clés rejetées** (le fichier est ignoré au chargement, la raison est journalisée dans `skippedReasons` ; les fichiers fournisseur voisins continuent à charger) :

| Catégorie          | Clés                                                                                                                                                                                                                                                                                                                                      | Raison                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réservées AI SDK   | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | L’adaptateur OpenAI-compatible les supprime silencieusement — à définir au niveau de l’agent.                                                                                                            |
| Écrasement du body | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | Écraseraient le body résolu de Tale, amplifieraient silencieusement le coût (`n`), casseraient la télémétrie d’usage (`stream_options`), ou fuiraient des données vers l’upstream (`store`, `metadata`). |

**Valeurs de quantisation OpenRouter :** `int4`, `int8`, `fp4`, `fp6`, `fp8`, `fp16`, `bf16`, `fp32`, `unknown`.

#### Passerelles vs. fournisseurs directs

`providerOptions` reflète exactement l’API de chaque upstream — mais **les types** d’options disponibles dépendent de la nature de l’upstream : passerelle de routage ou fournisseur d’inférence direct.

**Les passerelles** (OpenRouter, Vercel AI Gateway) se placent devant plusieurs backends et les agrègent sous un seul endpoint. Leurs champs passthrough sont des _contrôles de routage_ — choisir quel backend sert la requête, à quelle précision, avec quelle politique de repli :

```json
// OpenRouter — options de routage sous une clé "provider" de premier niveau.
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

```json
// Vercel AI Gateway — le routage se fait principalement via le préfixe d’ID
// de modèle (par ex. "anthropic/claude-3.5") et les en-têtes HTTP comme
// `ai-gateway-order`. La deny-list de Tale rejette `metadata` (vecteur
// d’egress de PII au niveau /v1/chat/completions), donc les tags
// d’observabilité doivent être configurés dans le tableau de bord Vercel
// plutôt que par requête.
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

Les `providerOptions` de Tale ne circulent que dans le corps de requête. Les contrôles de routage par en-tête (`ai-gateway-order`, `ai-gateway-only`) et les tags d’observabilité (`metadata`) ne sont actuellement pas paramétrables depuis une configuration de fournisseur ; épingle le routage via le préfixe d’ID de modèle et configure le tagging dans le tableau de bord Vercel.

**Les fournisseurs directs** (OpenAI, Anthropic, Together AI, Groq, DeepSeek, Mistral) hébergent leurs propres modèles. Il n’y a **pas de couche de routage** ni de **champ `quantizations`** — la précision est figée par l’éditeur au moment du déploiement. Leurs champs passthrough sont des _paramètres de comportement du modèle_ au niveau supérieur du body :

```json
// OpenAI — palier SLA, outils parallèles, routage du cache de prompt
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

```json
// Together AI — routage de modération, contrôles d’échantillonnage
"providerOptions": {
  "safety_model": "meta-llama/Llama-Guard-4-12B",
  "repetition_penalty": 1.1
}
```

Tale transmet tel quel — consulte la référence API de chaque fournisseur pour les noms exacts des champs et les valeurs acceptées. Les champs non reconnus par l’upstream sont silencieusement ignorés au gateway, donc une faute de frappe ressemble à un no-op plutôt qu’à un échec bruyant.

**Vérifier que ça arrive :** définis `TALE_DEBUG_LLM_WIRE=1` dans l’environnement du processus Convex (conteneur Convex auto-hébergé ou shell `bun run dev` Convex local) et observe stdout. Chaque requête LLM sortante (chat / embedding / image) routée via l’AI SDK affiche son URL plus les clés de body (avec `messages`/`input` masqués), permettant de confirmer que le champ `provider:` (ou autre) fusionné est présent. Le wrapper ne couvre pas la transcription, les sondes de test de connexion ni le chemin direct-fetch d’image-gen, et masque uniquement `messages`/`input` — les autres champs du body, y compris `system`, `tools`, `metadata`, `prompt_cache_key` et `user`, sont journalisés tels quels.

**Migration :** les `$TALE_CONFIG_DIR/providers/*.json` existants sans bloc `providerOptions` continuent de fonctionner tels quels — le champ est optionnel. Les nouveaux modèles ajoutés dans `examples/providers/openrouter.json` (GLM 5.x, Kimi K2.6, Qwen 3.6, Gemma 4) doivent être fusionnés manuellement dans les configs déployées.

## Stockage des secrets de fournisseur

Tale prend en charge deux formes sur disque pour `providers/<name>.secrets.json`. La détection du format est **basée sur le contenu** — le fichier parle pour lui-même, et Tale choisit le bon chemin quel que soit le processus (Convex, CLI, services Python) qui le lit.

### Mode chiffré (`SOPS_AGE_KEY` défini)

Quand `SOPS_AGE_KEY` (ou `SOPS_AGE_KEY_FILE`) est défini dans `.env`, Tale stocke les secrets chiffrés via [SOPS](https://github.com/getsops/sops) avec le destinataire age configuré. `tale init` génère automatiquement une clé et utilise ce mode par défaut. Le fichier sur disque ressemble à :

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

**La rotation des clés** utilise la forme fichier de la variable. Avec `SOPS_AGE_KEY_FILE` pointant vers un fichier contenant une ou plusieurs clés age (une par ligne, commentaires `#` autorisés) :

1. Ajoute la nouvelle clé age comme nouvelle ligne dans le fichier de clés.
2. Réenregistre la clé d’API de chaque fournisseur via **Paramètres > Fournisseurs IA**. Chaque enregistrement produit désormais un texte chiffré lisible à la fois avec l’ancienne ET la nouvelle clé.
3. Une fois tous les fournisseurs réenregistrés, retire l’ancienne clé du fichier. Les nouveaux enregistrements ne chiffrent plus que pour le nouveau destinataire ; les fichiers existants continuent de se déchiffrer car sops parcourt toutes les clés du fichier.

La forme inline `SOPS_AGE_KEY` ne supporte pas plusieurs clés — passe à `SOPS_AGE_KEY_FILE` pour la rotation.

### Mode clair (`SOPS_AGE_KEY` non défini)

`tale init` provisionne toujours `SOPS_AGE_KEY`, donc on atteint le mode clair en effaçant `SOPS_AGE_KEY` (et en ne définissant pas `SOPS_AGE_KEY_FILE`) dans `.env` après l’init, puis en réenregistrant les clés via **Paramètres > Fournisseurs IA**. Les nouveaux enregistrements produisent du JSON en clair avec un mode de fichier `0600`. Ce mode est destiné aux setups auto-hébergés qui gèrent déjà les credentials en externe (Kubernetes Secrets, fichiers injectés par Vault, volumes bind montés, etc.) :

```json
{ "apiKey": "sk-…" }
```

La forme en clair n’est lisible que par le propriétaire et est exclue de Git via le `.gitignore` scaffold. La plateforme journalise un avertissement unique au démarrage afin que la posture de stockage soit visible pour les opérateurs.

### Basculer entre les modes

Le format de fichier est auto-descriptif, donc un fichier chiffré par SOPS reste déchiffrable après le passage en mode clair (à condition de garder la clé), et un fichier en clair reste lisible après l’activation du chiffrement — Tale ne rechiffrera qu’à la prochaine sauvegarde via l’UI.

Pour éviter une perte de données irrécupérable, **la plateforme refuse d’écraser en clair un fichier de secrets SOPS existant** quand `SOPS_AGE_KEY` n’est plus défini. Résous-le explicitement : restaure la clé, ou supprime le fichier chiffré avant d’enregistrer de nouveaux credentials.

Si tu préfères éviter SOPS de bout en bout, définis plutôt la clé API via l’UI — **Paramètres > Fournisseurs IA > Modifier > clé API**. L’application utilise le mode configuré par `.env`.

## Utiliser les fournisseurs exemple livrés

Le dépôt fournit des configs prêtes à l’emploi dans `examples/providers/`. Copie-en une dans ton répertoire de config et fournis ta propre clé.

### OpenRouter (chat + vision multi-vendeurs)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Obtiens une clé sur [openrouter.ai/keys](https://openrouter.ai/keys) et ajoute-la via l’UI dans **Paramètres > Fournisseurs IA > OpenRouter** — l’application écrit le `openrouter.secrets.json` correspondant pour toi, dans le mode configuré. (Les fichiers `examples/providers/*.secrets.json` livrés sont chiffrés par SOPS pour le destinataire age du dépôt et ne servent pas de modèles plug-and-play.)

L’exemple inclut des modèles de plusieurs constructeurs :

| Constructeur | Modèles                                   | Tags         |
| ------------ | ----------------------------------------- | ------------ |
| Anthropic    | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5    | chat, vision |
| OpenAI       | GPT-5.2, GPT-5.2 Instant, GPT-5.2 Pro     | chat, vision |
| Google       | Gemini 3 Pro, Gemini 3 Flash              | chat, vision |
| Mistral      | Mistral Large 3, Mistral Medium 3         | chat         |
| Meta         | LLaMA 4 Maverick, LLaMA 4 Scout           | chat         |
| DeepSeek     | DeepSeek V3.2                             | chat         |
| Moonshot     | Kimi K2.5                                 | chat         |
| Qwen         | Qwen3 Next 80B, Qwen3.5 35B, Qwen3 VL 32B | chat, vision |

### OpenAI (Whisper pour la transcription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
```

Ajoute ta clé OpenAI via **Paramètres > Fournisseurs IA > OpenAI**. Le fichier déclare `whisper-1` et `defaults.transcription`, donc les pièces jointes audio et vidéo du chat sont routées ici dès qu’une clé est définie. Voir [Pièces jointes du chat](/fr/platform/chat/attachments#transcription-audio-et-vidéo) pour la vue utilisateur.

## Backends d’inférence auto-hébergés

Tout serveur exposant une API compatible OpenAI peut servir de fournisseur. Ajoute un fichier JSON avec sa base URL et les IDs des modèles servis. Backends fréquents :

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (transcription uniquement)

### Exemple — Ollama

```json
{
  "displayName": "Ollama (local)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    { "id": "llama3.3", "displayName": "LLaMA 3.3", "tags": ["chat"] },
    { "id": "mistral", "displayName": "Mistral 7B", "tags": ["chat"] }
  ]
}
```

Ollama n’exige pas d’authentification ; mets `apiKey` à n’importe quel placeholder non vide dans le fichier secrets.

### Exemple — Whisper local pour la transcription

```json
{
  "displayName": "Local Whisper",
  "baseUrl": "http://localhost:8000/v1",
  "defaults": { "transcription": "Systran/faster-whisper-base" },
  "models": [
    {
      "id": "Systran/faster-whisper-base",
      "displayName": "Faster-Whisper Base",
      "tags": ["transcription"]
    }
  ]
}
```

Tale appelle `{baseUrl}/audio/transcriptions` et attend le format de réponse `verbose_json` compatible OpenAI — faster-whisper-server, vLLM et LocalAI le supportent tous.

## Réseau hôte Docker

Quand Tale tourne dans un conteneur Docker et que le backend d’inférence tourne sur l’hôte Docker (Ollama, vLLM, LocalAI), `localhost` dans le conteneur pointe vers le conteneur, pas vers l’hôte. Options :

- **Docker Desktop (Mac, Windows)** — utilise `http://host.docker.internal:<port>/v1`.
- **Linux** — ajoute `extra_hosts: ["host.docker.internal:host-gateway"]` au service platform dans `compose.yml`, utilise l’IP LAN de l’hôte, ou mets Tale et le backend sur le même réseau Docker et référence le backend par son nom de service.

## Rendre les modèles disponibles aux agents

Un modèle défini dans un fichier de fournisseur n’est que _joignable_. Pour qu’il apparaisse dans le sélecteur de modèle d’un agent, ajoute son `id` au tableau `supportedModels` de l’agent dans `TALE_CONFIG_DIR/agents/<slug>.json` :

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.6"]
}
```

Les IDs doivent correspondre exactement au champ `id` de la définition de modèle du fournisseur. Seules les entrées avec le tag `chat` apparaissent dans le sélecteur de modèle du chat ; les modèles `embedding` sont utilisés par la base de connaissances, les modèles `transcription` par le pipeline audio, etc.

### Épingler à un fournisseur précis

Quand le même id de modèle est défini dans plus d’un fichier fournisseur (p. ex. `anthropic/claude-opus-4.6` à la fois dans `openrouter.json` et dans un `anthropic.json` direct), préfixe l’entrée avec `<provider>:` pour épingler explicitement le routage :

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.6",
    "anthropic:claude-opus-4.6"
  ]
}
```

Les entrées simples (sans deux-points) résolvent vers le premier fournisseur qui définit l’id. Le chemin d’enregistrement de l’agent émet un avertissement quand une entrée non qualifiée matche plus d’un fournisseur, ce qui te permet de désambiguïser. Les modifications directes de fichier contournent cette validation d’enregistrement — le resolver runtime remontera les avertissements, mais épingler explicitement est plus sûr dans les setups multi-fournisseurs.

## Où cela s'insère

Les fichiers fournisseurs décrits ici sont la forme sur disque de la même configuration que l'interface écrit quand un Admin enregistre depuis **Paramètres > Fournisseurs IA**. Choisis la surface qui colle à ta posture de gestion de changements : l'interface pour les ajustements quotidiens et les rollouts rapides, les fichiers quand la configuration doit vivre dans git avec le reste de ton infrastructure. Dans les deux cas, l'endroit canonique pour lire ce que veut dire chaque champ reste cette page.

Références voisines : [Fournisseurs IA](/fr/platform/admin/providers) couvre la contrepartie UI pour les Admins, [Pièces jointes du chat](/fr/platform/chat/attachments#transcription-audio-et-vidéo) montre comment les modèles transcription configurés ici sont consommés côté utilisateur, et [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) documente `TALE_CONFIG_DIR` et les autres variables que cette page présuppose.

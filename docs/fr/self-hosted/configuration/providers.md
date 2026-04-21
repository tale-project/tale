---
title: Fournisseurs IA
description: Configure des fournisseurs de modèles IA via des fichiers JSON, connecte des backends d'inférence auto-hébergés et chiffre les secrets avec SOPS.
---

Les fournisseurs relient Tale aux modèles IA via des API HTTP compatibles OpenAI. Les admins peuvent ajouter et modifier des fournisseurs depuis **Paramètres > Fournisseurs IA** dans l'application — voir [Fournisseurs IA](/fr/platform/admin/providers) pour le parcours UI et le concept. Cette page couvre la forme fichier : les JSON dans `TALE_CONFIG_DIR/providers/`, leur schéma, les secrets chiffrés par SOPS et comment pointer Tale vers des backends d'inférence auto-hébergés comme Ollama, vLLM, LocalAI ou faster-whisper-server.

La forme UI et la forme fichier sont équivalentes — l'application écrit le même JSON quand tu enregistres depuis **Paramètres > Fournisseurs IA**. Choisis ce qui convient à ton workflow de change-management : les modifications UI vont plus vite au quotidien, les modifications fichier se committent proprement dans Git et conviennent aux opérateurs en infrastructure-as-code.

## Disposition des fichiers

La configuration des fournisseurs vit dans le sous-répertoire `providers/` de `TALE_CONFIG_DIR`. Voir la [référence d'environnement](/fr/self-hosted/configuration/environment-reference) pour la valeur de la variable selon le type de déploiement.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # SOPS-encrypted API key — committable
    openai.json
    openai.secrets.json
```

- `providers/<name>.json` — config publique : base URL, définitions de modèles, tags, valeurs par défaut.
- `providers/<name>.secrets.json` — la clé API, chiffrée par SOPS. Ne committe jamais la forme non chiffrée.

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
| `displayName`    | Libellé affiché dans l'UI et les sélecteurs de modèle.                                                                                                          |
| `description`    | Explication optionnelle affichée dans la liste des fournisseurs.                                                                                                |
| `baseUrl`        | Endpoint compatible OpenAI. `/chat/completions`, `/embeddings`, `/audio/transcriptions`, etc. sont ajoutés par Tale.                                            |
| `defaults`       | Modèle par défaut par capability quand aucun choix explicite n'existe. Clés : `chat`, `vision`, `embedding`, `image-generation`, `transcription`.               |
| `models[*].id`   | Doit correspondre exactement au nom de modèle accepté par l'endpoint (p. ex. `llama3.3` pour Ollama, `Systran/faster-whisper-base` pour faster-whisper-server). |
| `models[*].tags` | Un ou plusieurs parmi `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription` — contrôle où le modèle apparaît.                        |
| `models[*].cost` | Tarification optionnelle — voir le tableau des coûts ci-dessous.                                                                                                |

### Champs de coût

Les tarifs sont déclarés par modèle pour que le registre d'usage puisse estimer les coûts. Les modèles facturés au token et ceux facturés à l'unité utilisent des champs différents :

| Champ                   | S'applique à                     | Notes                                                                   |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `inputCentsPerMillion`  | Chat, vision, embedding          | Prix par million de tokens en entrée.                                   |
| `outputCentsPerMillion` | Chat, vision                     | Prix par million de tokens en sortie.                                   |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Prix fixe par image générée. Contourne le calcul par tokens.            |
| `centsPerAudioMinute`   | `transcription`                  | Prix par minute d'audio. OpenAI Whisper est à `0.6` (soit 0,006 $/min). |

Laisse `cost` vide pour les backends auto-hébergés où la dépense est opérationnelle plutôt que par appel — l'usage reste journalisé, mais la colonne coût estimé vaut `0`.

## Secrets chiffrés par SOPS

Le fichier `providers/<name>.secrets.json` contient la clé API et est chiffré avec [SOPS](https://github.com/getsops/sops) en utilisant le destinataire age du dépôt. Sous forme non chiffrée :

```json
{ "apiKey": "sk-…" }
```

Ne committe jamais cela. Chiffre avec `sops --encrypt --in-place providers/<name>.secrets.json` avant de committer — Tale déchiffre au démarrage. Si tu fais tourner une clé, rechiffre le fichier mis à jour et redémarre (ou laisse le watcher de config prendre le changement, selon ton déploiement).

Si tu préfères éviter SOPS de bout en bout, définis plutôt la clé API via l'UI — **Paramètres > Fournisseurs IA > Modifier > clé API**. L'application gère le chiffrement de manière transparente.

## Utiliser les fournisseurs exemple livrés

Le dépôt fournit des configs prêtes à l'emploi dans `examples/providers/`. Copie-en une dans ton répertoire de config et fournis ta propre clé.

### OpenRouter (chat + vision multi-vendeurs)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openrouter.secrets.json $TALE_CONFIG_DIR/providers/
```

Obtiens une clé sur [openrouter.ai/keys](https://openrouter.ai/keys) et soit rechiffre le fichier secrets avec ton propre destinataire SOPS, soit mets-le à jour via l'UI dans **Paramètres > Fournisseurs IA > OpenRouter**.

L'exemple inclut des modèles de plusieurs constructeurs :

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
cp examples/providers/openai.secrets.json $TALE_CONFIG_DIR/providers/
```

Le fichier déclare `whisper-1` et `defaults.transcription`, donc les pièces jointes audio et vidéo du chat sont routées ici dès qu'une clé est définie. Voir [Pièces jointes du chat](/fr/platform/chat/attachments#transcription-audio-et-vidéo) pour la vue utilisateur.

## Backends d'inférence auto-hébergés

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

Ollama n'exige pas d'authentification ; mets `apiKey` à n'importe quel placeholder non vide dans le fichier secrets.

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

Quand Tale tourne dans un conteneur Docker et que le backend d'inférence tourne sur l'hôte Docker (Ollama, vLLM, LocalAI), `localhost` dans le conteneur pointe vers le conteneur, pas vers l'hôte. Options :

- **Docker Desktop (Mac, Windows)** — utilise `http://host.docker.internal:<port>/v1`.
- **Linux** — ajoute `extra_hosts: ["host.docker.internal:host-gateway"]` au service platform dans `compose.yml`, utilise l'IP LAN de l'hôte, ou mets Tale et le backend sur le même réseau Docker et référence le backend par son nom de service.

## Rendre les modèles disponibles aux agents

Un modèle défini dans un fichier de fournisseur n'est que _joignable_. Pour qu'il apparaisse dans le sélecteur de modèle d'un agent, ajoute son `id` au tableau `supportedModels` de l'agent dans `TALE_CONFIG_DIR/agents/<slug>.json` :

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.6"]
}
```

Les IDs doivent correspondre exactement au champ `id` de la définition de modèle du fournisseur. Seules les entrées avec le tag `chat` apparaissent dans le sélecteur de modèle du chat ; les modèles `embedding` sont utilisés par la base de connaissances, les modèles `transcription` par le pipeline audio, etc.

### Épingler à un fournisseur précis

Quand le même id de modèle est défini dans plus d'un fichier fournisseur (p. ex. `anthropic/claude-opus-4.6` à la fois dans `openrouter.json` et dans un `anthropic.json` direct), préfixe l'entrée avec `<provider>:` pour épingler explicitement le routage :

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.6",
    "anthropic:claude-opus-4.6"
  ]
}
```

Les entrées simples (sans deux-points) résolvent vers le premier fournisseur qui définit l'id. Le chemin d'enregistrement de l'agent émet un avertissement quand une entrée non qualifiée matche plus d'un fournisseur, ce qui te permet de désambiguïser. Les modifications directes de fichier contournent cette validation d'enregistrement — le resolver runtime remontera les avertissements, mais épingler explicitement est plus sûr dans les setups multi-fournisseurs.

## Voir aussi

- [Fournisseurs IA](/fr/platform/admin/providers) — gérer les fournisseurs via l'UI.
- [Pièces jointes du chat](/fr/platform/chat/attachments#transcription-audio-et-vidéo) — comment les modèles tagués `transcription` sont utilisés.
- [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` et les variables liées.

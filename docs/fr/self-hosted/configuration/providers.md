---
title: Fournisseurs IA
description: Configure les fournisseurs de modèles IA via des fichiers JSON, connecte des backends d'inférence auto-hébergés et stocke les secrets chiffrés (SOPS) ou en texte clair.
---

Les fournisseurs branchent Tale sur les modèles IA via des API HTTP compatibles OpenAI — OpenRouter, OpenAI direct, Anthropic, Together, Groq, ou un serveur Ollama ou vLLM auto-hébergé. Cette page est la référence de la configuration sur disque sous `TALE_CONFIG_DIR/providers/` : le schéma JSON, les modes de stockage des secrets, les règles de routage pour choisir un modèle et les schémas de passthrough par fournisseur. Pour la contrepartie UI que les Admins atteignent dans l'application, [Fournisseurs IA](/fr/platform/admin/providers) est la référence côté plateforme.

La forme UI et la forme fichier sont équivalentes. L'application écrit le même JSON quand un Admin enregistre depuis **Paramètres > Fournisseurs IA** que celui que tu écrirais à la main ; choisis ce qui colle à ton workflow de gestion des changements. Les éditions UI sont plus rapides pour les retouches du jour ; les éditions de fichier rentrent proprement dans git et conviennent aux opérateurs infrastructure-as-code.

## Un exemple concret

Dépose ces deux fichiers sous `$TALE_CONFIG_DIR/providers/`, donne au fichier de secrets des permissions propriétaire uniquement, et Tale prend le fournisseur au prochain rechargement — aucun redémarrage nécessaire.

`openrouter.json` :

```json
{
  "displayName": "OpenRouter",
  "description": "Multi-vendor gateway for chat and vision models.",
  "baseUrl": "https://openrouter.ai/api/v1",
  "defaults": {
    "chat": "anthropic/claude-opus-4.7"
  },
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "anthropic/claude-opus-4.7",
      "displayName": "Claude Opus 4.7",
      "tags": ["chat", "vision"],
      "cost": {
        "inputCentsPerMillion": 1500,
        "outputCentsPerMillion": 7500
      }
    }
  ]
}
```

`openrouter.secrets.json` (forme texte clair ; la forme chiffrée SOPS est montrée plus bas) :

```json
{ "apiKey": "sk-or-v1-..." }
```

Le radical du nom de fichier (`openrouter`) est le slug interne du fournisseur. Les deux fichiers partagent ce radical ; des noms désaccordés signifient que le secret n'atteint jamais le runtime.

## Disposition des fichiers

La configuration des fournisseurs vit dans le sous-répertoire `providers/` de `TALE_CONFIG_DIR`. Chaque fournisseur a deux fichiers : une configuration publique qui peut sans risque être versionnée, et un fichier de secrets qui porte la clé API.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # config publique — versionnable
    openrouter.secrets.json  # clé API — ne jamais versionner
    openai.json
    openai.secrets.json
```

Le fichier `.json` public porte l'URL de base, la liste des modèles, le schéma de coût et le bloc optionnel `providerOptions`. Le frère `.secrets.json` ne porte que la clé API ; il est chiffré avec SOPS quand `SOPS_AGE_KEY` est défini, et en texte clair en mode fichier `0600` sinon. `tale init` ajoute `**/*.secrets.json` au `.gitignore` du projet pour qu'aucune des deux formes n'atterrisse jamais dans le contrôle de version par accident.

## Schéma de la config publique

Le schéma ci-dessous nomme chaque champ de premier niveau. `displayName`, `baseUrl` et au moins un modèle sont le minimum pratique ; tout le reste a une valeur par défaut raisonnable ou contrôle le grand livre des coûts.

| Champ            | Description                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`    | Étiquette affichée dans l'interface et dans les sélecteurs de modèles.                                                                                          |
| `description`    | Explication optionnelle affichée dans la liste des fournisseurs.                                                                                                |
| `baseUrl`        | Endpoint compatible OpenAI. Tale ajoute `/chat/completions`, `/embeddings`, `/audio/transcriptions`, etc.                                                       |
| `defaults`       | Modèle par défaut par capacité quand aucun choix explicite n'existe. Clés : `chat`, `vision`, `embedding`, `image-generation`, `transcription`.                 |
| `models[*].id`   | Doit correspondre au nom de modèle que l'endpoint amont accepte (`llama3.3` pour Ollama ; `Systran/faster-whisper-base` pour faster-whisper-server).            |
| `models[*].tags` | Une ou plusieurs valeurs parmi `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription`. Décide où le modèle apparaît dans l'interface. |
| `models[*].cost` | Tarification optionnelle. Voir le tableau des coûts ci-dessous.                                                                                                 |

### Champs de coût

La tarification est déclarée par modèle pour que le grand livre d'usage puisse estimer les coûts. Les modèles facturés au jeton utilisent les champs par million ; les modèles image et audio utilisent les champs par unité.

| Champ                   | S'applique à                     | Description                                                      |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `inputCentsPerMillion`  | chat, vision, embedding          | Prix par million de jetons en entrée.                            |
| `outputCentsPerMillion` | chat, vision                     | Prix par million de jetons en sortie.                            |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Prix fixe par image générée.                                     |
| `centsPerAudioMinute`   | `transcription`                  | Prix par minute audio. OpenAI Whisper est à `0.6` (0,006 $/min). |

Laisse le bloc `cost` de côté pour les backends auto-hébergés où la dépense est opérationnelle plutôt que par appel. L'usage reste journalisé ; la colonne de coût affiche `0`.

### Options de fournisseur

Tale propage des champs de corps de requête arbitraires propres au fournisseur via un bloc optionnel `providerOptions`. Le bloc est autorisé à la fois au niveau fournisseur et au niveau modèle ; les valeurs par modèle surchargent celles du fournisseur pour une même clé.

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

Trois règles gouvernent `providerOptions`. Écris la forme **intérieure** du corps de requête — Tale l'enveloppe sous le nom de fournisseur réel à l'appel, donc n'enrobe pas en `{ "openrouter": { ... } }`. La **précédence de fusion** part du niveau fournisseur puis du niveau modèle, avec les clés partagées fusionnées en profondeur 2 (les sous-clés fusionnent et le modèle l'emporte, les tableaux remplacent en bloc). Et une liste fermée de **clés rejetées** est silencieusement retirée parce qu'elles écraseraient le corps de requête résolu par Tale ou fuiteraient des données :

| Catégorie           | Clés                                                                                                                                                                                                                                                                                                                                      | Raison                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Réservées AI SDK    | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | L'adaptateur compatible OpenAI les retire. À définir au niveau de l'agent à la place.                                                                                                                                                            |
| Écrasement du corps | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | Écraserait le corps résolu par Tale, amplifierait silencieusement le coût (`n`), casserait la télémétrie d'usage (`stream_options`), fuiterait des données en amont (`store`, `metadata`) ou contournerait le plafond de jetons de raisonnement. |

Les fichiers qui contiennent des clés rejetées sont sautés au chargement avec la raison consignée dans `skippedReasons` ; les fichiers de fournisseurs voisins continuent à charger.

### Passerelles et fournisseurs directs

Le même bloc `providerOptions` porte des **types** de boutons différents selon que l'amont est une passerelle de routage ou un fournisseur direct.

Les **passerelles** se placent devant plusieurs backends. Leurs champs propagés sont des contrôles de routage — choisir quel backend sert la requête, à quelle précision, avec quelle politique de repli. OpenRouter expose le routage sous une clé `provider` de premier niveau :

```json
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

Vercel AI Gateway route surtout via le préfixe d'identifiant de modèle (`anthropic/claude-3.5`) et via des en-têtes HTTP (`ai-gateway-order`). `providerOptions` de Tale ne coule que dans le corps de la requête, donc les contrôles de routage au niveau en-tête et les tags d'observabilité configurés dans le tableau de bord Vercel restent hors du fichier de fournisseur :

```json
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

Les **fournisseurs directs** hébergent leurs propres modèles. Pas de couche de routage — la précision est fixe par modèle côté fournisseur, et `quantizations` n'a pas de sens. Leurs champs propagés sont des boutons de comportement de modèle au sommet du corps :

```json
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

Tale propage tel quel. La référence d'API de chaque fournisseur est la source de vérité des noms de champs exacts ; l'amont ignore silencieusement les champs qu'il ne reconnaît pas, donc une coquille ressemble à un no-op plutôt qu'à un échec.

**Vérifier que c'est arrivé.** Mets `TALE_DEBUG_LLM_WIRE=1` dans l'environnement du conteneur Convex. Le wrapper imprime sur stdout chaque requête LLM sortante de chat, d'embedding et d'image — URL, plus clés du corps avec `messages` et `input` masqués — pour que tu confirmes que le champ d'options fusionné est bien arrivé. Le wrapper ne couvre ni la transcription, ni les sondes de connexion, ni le chemin direct-fetch de génération d'images.

**Migration.** Les fichiers `.json` existants sans bloc `providerOptions` continuent de marcher inchangés ; le bloc est optionnel. Les nouveaux modèles ajoutés au `examples/providers/openrouter.json` livré doivent être fusionnés à la main dans les configs déployées.

## Stockage des secrets de fournisseur

Les deux formes sur disque — chiffrée SOPS et texte clair — sont détectées par contenu au chargement. Le runtime choisit le bon chemin quel que soit le processus (convex, le CLI ou les services Python) qui lit.

### Chiffré (`SOPS_AGE_KEY` défini)

Quand `SOPS_AGE_KEY` ou `SOPS_AGE_KEY_FILE` est défini, Tale stocke les secrets chiffrés avec [SOPS](https://github.com/getsops/sops) sous le destinataire age configuré. `tale init` provisionne une clé par défaut et utilise ce mode :

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

La **rotation de clés** passe par la forme fichier. Pointe `SOPS_AGE_KEY_FILE` sur un fichier qui contient une ou plusieurs clés age (une par ligne, commentaires `#` autorisés), puis :

1. Ajoute la nouvelle clé sur une nouvelle ligne du fichier de clés.
2. Réenregistre la clé API de chaque fournisseur dans **Paramètres > Fournisseurs IA**. Chaque enregistrement produit maintenant un chiffré lisible à la fois par l'ancienne et la nouvelle clé.
3. Une fois chaque fournisseur réenregistré, retire l'ancienne clé. Les nouveaux enregistrements ne chiffrent que pour le nouveau destinataire ; les fichiers existants continuent de se déchiffrer parce que sops parcourt chaque clé du fichier.

La forme inline `SOPS_AGE_KEY` ne gère pas plusieurs clés — bascule sur la forme fichier pour la rotation.

### Texte clair (`SOPS_AGE_KEY` non défini)

`tale init` provisionne toujours une clé, donc le mode texte clair demande de retirer explicitement `SOPS_AGE_KEY` de `.env` après l'init et de réenregistrer les clés via l'interface. Les nouveaux enregistrements produisent du JSON en clair en mode fichier `0600` :

```json
{ "apiKey": "sk-..." }
```

Le texte clair convient quand un système externe gère déjà les identifiants — Kubernetes Secrets, un fichier injecté par Vault, un volume monté en bind. La plateforme journalise un avertissement unique au démarrage pour que la posture de stockage reste visible aux opérateurs.

### Changer de mode

Le format de fichier est auto-descriptif. Un fichier chiffré SOPS reste déchiffrable après un passage en texte clair (à condition de garder la clé), et un fichier en clair reste lisible après l'activation du chiffrement — Tale ne re-chiffre qu'au prochain enregistrement par l'interface.

Pour éviter une perte de données irrécupérable, la plateforme refuse d'écraser un fichier chiffré SOPS existant avec du texte clair quand `SOPS_AGE_KEY` n'est plus défini. Restaure la clé ou retire le fichier chiffré avant d'enregistrer de nouveaux identifiants.

## Utiliser les exemples livrés

Le dépôt livre des configs d'exemple prêtes à l'emploi sous `examples/providers/`. Copie l'une d'entre elles dans ton répertoire de config et ajoute la clé via l'interface.

### OpenRouter (passerelle multi-fournisseurs)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Récupère une clé sur [openrouter.ai/keys](https://openrouter.ai/keys) et ajoute-la via **Paramètres > Fournisseurs IA > OpenRouter** — l'application écrit le `openrouter.secrets.json` correspondant dans le mode configuré. Les fichiers `examples/providers/*.secrets.json` versionnés sont chiffrés pour le destinataire age du dépôt et ne servent pas comme modèles prêts à l'emploi.

### OpenAI (Whisper pour la transcription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
```

Ajoute ta clé OpenAI via **Paramètres > Fournisseurs IA > OpenAI**. L'exemple déclare `whisper-1` et `defaults.transcription`, donc les pièces jointes audio et vidéo passent par là dès qu'une clé est posée. La vue côté utilisateur final vit sur [Pièces jointes de chat](/fr/platform/chat/attachments#audio-and-video-transcription).

## Backends d'inférence auto-hébergés

Tout serveur qui parle l'API HTTP OpenAI peut être un fournisseur. Ajoute un fichier JSON avec l'URL de base et les modèles que le serveur héberge. Backends courants :

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (transcription uniquement)

### Ollama

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

Ollama ne demande pas d'authentification. Mets `apiKey` à n'importe quel placeholder non vide dans le fichier de secrets — le champ est requis par le schéma, mais le runtime propage la valeur vers un serveur qui l'ignore.

### Whisper local

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

Tale appelle `{baseUrl}/audio/transcriptions` et attend la forme de réponse OpenAI `verbose_json`. faster-whisper-server, vLLM et LocalAI la supportent tous.

## Réseau hôte Docker

Quand Tale tourne dans un conteneur Docker et que le backend d'inférence tourne sur l'hôte Docker (Ollama, vLLM, LocalAI), `localhost` à l'intérieur du conteneur pointe sur le conteneur — pas sur l'hôte. La correction dépend du système hôte.

Sur Docker Desktop (Mac, Windows), atteins l'hôte via son alias DNS : `http://host.docker.internal:<port>/v1`. Sur Linux, ajoute `extra_hosts: ["host.docker.internal:host-gateway"]` au service plateforme dans `compose.yml`, ou utilise directement l'IP LAN de l'hôte, ou pose Tale et le backend sur le même réseau Docker et référence le backend par nom de service.

## Rendre les modèles disponibles aux agents

Un modèle défini dans un fichier de fournisseur est joignable, mais pas encore visible. Pour qu'il apparaisse dans le sélecteur de modèles d'un agent, ajoute son `id` au tableau `supportedModels` de l'agent dans `TALE_CONFIG_DIR/agents/<slug>.json` :

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.7"]
}
```

Les identifiants correspondent au champ `id` de la définition du modèle dans le fournisseur, exactement. Seules les entrées taguées `chat` apparaissent dans le sélecteur de modèle de chat ; les modèles `embedding` sont pris par la base de connaissances, les modèles `transcription` par le pipeline audio, et ainsi de suite.

### Épingler sur un fournisseur précis

Quand le même identifiant de modèle est défini dans plus d'un fichier de fournisseur (`anthropic/claude-opus-4.7` à la fois dans `openrouter.json` et dans un `anthropic.json` direct), préfixe l'entrée avec `<provider>:` pour épingler le routage :

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.7",
    "anthropic:claude-opus-4.7"
  ]
}
```

Les entrées simples (sans deux-points) se résolvent sur le premier fournisseur qui définit l'identifiant. Le chemin d'enregistrement de l'agent émet un avertissement quand une entrée non qualifiée matche plus d'un fournisseur ; les éditions directes de fichier contournent cette validation à l'enregistrement, donc préfère l'épinglage explicite pour les configurations multi-fournisseurs.

## Où cela s'insère

Les fichiers de fournisseur décrits ici sont la forme sur disque de la même configuration que l'interface écrit quand un Admin enregistre depuis **Paramètres > Fournisseurs IA**. Choisis la surface qui colle à ta posture de gestion des changements : l'interface pour les retouches du jour, les fichiers quand la configuration appartient à git aux côtés du reste de l'infrastructure. Quoi qu'il en soit, cette page est la référence canonique de ce que chaque champ veut dire.

[Fournisseurs IA](/fr/platform/admin/providers) est la contrepartie UI pour les Admins. [Pièces jointes de chat](/fr/platform/chat/attachments#audio-and-video-transcription) montre comment les modèles tagués transcription atteignent les utilisateurs finaux. [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) couvre `TALE_CONFIG_DIR` et les autres variables que cette page suppose.

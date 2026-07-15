---
title: Fournisseurs
description: Le format à deux fichiers des fournisseurs sur disque — `<name>.json` pour la forme publique, `<name>.secrets.json` pour les clés — plus le workflow pour ajouter, échanger et désactiver un fournisseur de modèle.
---

Tale stocke chaque fournisseur de modèle sous forme de deux fichiers sous `providers/` — un `<name>.json` pour la forme publique (URL de base, modèles, capacités) et un `<name>.secrets.json` pour les clés API. La séparation existe pour que la config soit safe à commit et que les secrets reçoivent le traitement chiffré que SOPS leur donne. Le conteneur `tale-platform` lit les deux au boot et les surveille pour les changements ; redémarrer le conteneur n'est pas requis pour prendre en compte des éditions.

La référence est le format de fichier sur disque et l'ordre des opérations à suivre en ajoutant un fournisseur. Le flow piloté par l'UI ("Paramètres > Fournisseurs") s'assied sur les mêmes fichiers ; les deux produisent des résultats identiques.

## Le fichier de config

`providers/<name>.json` décrit la forme publique du fournisseur. Le `displayName` apparaît dans l'UI, le tableau `models` nomme tout ce qui est joignable via ce fournisseur, et chaque modèle déclare ses tags (`chat`, `vision`, `embedding`, `transcription`, `text-to-speech`).

```json
{
  "displayName": "OpenRouter",
  "description": "Chat, vision, embeddings, voix et génération d'images via une seule clé.",
  "baseUrl": "https://openrouter.ai/api/v1",
  "secretsEnv": "TALE_PROVIDER_KEY_OPENROUTER",
  "defaults": {
    "transcription": "openai/whisper-1",
    "text-to-speech": "openai/gpt-4o-mini-tts-2025-12-15"
  },
  "models": [
    {
      "id": "openai/whisper-1",
      "displayName": "Whisper v1",
      "tags": ["transcription"],
      "transcriptionMode": "json-base64",
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

L'ensemble complet des champs vit dans [`builtin-configs/providers/`](https://github.com/tale-project/tale/tree/main/builtin-configs/providers). Le défaut livré est un seul `openrouter.json` qui couvre le chat, la vision, les embeddings, la transcription, la synthèse vocale et la génération d'images — une clé pour tout — avec des presets curés pour les fournisseurs courants (Anthropic, OpenAI, Google, xAI, Mistral, Meta, DeepSeek, Qwen, Cohere, Amazon, Perplexity et plus). Pour appeler un fournisseur directement plutôt que via OpenRouter, ajoute un autre fichier (par exemple un `openai.json` pointant vers `https://api.openai.com/v1`) ; voir [Modèles livrés en standard](/fr/platform/models) pour le catalogue complet par défaut.

`transcriptionMode` sélectionne la forme du corps de requête d'un modèle `transcription` : `json-base64` (l'enveloppe `input_audio` d'OpenRouter) ou, s'il est omis, `multipart` — l'upload `multipart/form-data` OpenAI/Whisper qu'attendent aussi vLLM, LocalAI et une clé OpenAI directe. Définis-le selon l'endpoint de transcription que tu vises.

### Capacités des modèles et synchronisation auto

Chaque modèle peut déclarer des métadonnées optionnelles utilisées par le routage par complexité et l'Adaptive Reasoning Governor : `contextWindow`, `maxOutputTokens`, `qualityScore` (0–1), `tier` (`draft`/`standard`/`frontier`), `routingTags` (domaines préférés), `reasoning` (le bouton de pilotage — `effort` ou `budgetTokens`) et `promptCaching` (`auto-server` ou `explicit-breakpoints`). Tout ce que tu omets est rempli depuis le catalogue OpenRouter à l'exécution ; tout ce que tu définis l'emporte. Mets `"hidden": true` pour retirer un modèle des sélecteurs (chat, création d'agent) tout en le gardant résoluble pour les agents qui le référencent déjà — la façon de retirer une version remplacée sans casser les workflows existants.

Ces champs restent aussi à jour tout seuls : une fois par semaine, Tale fusionne les nouvelles données OpenRouter dans la config fournisseur de chaque organisation — ajoutant les nouvelles versions phares, masquant celles remplacées et actualisant les valeurs de capacités — en ne touchant que les champs que tu n'as pas personnalisés. Désactive-le par organisation avec l'interrupteur **Synchronisation auto hebdomadaire** sur la carte du catalogue de modèles dans **Paramètres > Fournisseurs**.

Quand `maxOutputTokens` n'est pas défini, Tale plafonne la sortie à **32 768** tokens. Mets `0` pour n'envoyer aucune limite. Réduis la valeur au plafond réel de ton déploiement si le fournisseur rejette les valeurs trop élevées (par ex. un déploiement Azure GPT-4o renvoyant `max_tokens is too large`).

### Mappage du corps de requête

Certains points de terminaison attendent une forme de requête légèrement différente de la forme OpenAI-compatible standard. Un modèle — ou le fournisseur, comme valeur par défaut — peut déclarer un `requestBodyMap` qui réécrit le corps de requête final à l'envoi :

```json
{
  "requestBodyMap": {
    "rename": { "max_tokens": "max_completion_tokens" },
    "remove": ["frequency_penalty"]
  }
}
```

`rename` renomme un champ en un autre (appliqué en premier) ; `remove` supprime les champs que le point de terminaison rejette. Un `requestBodyMap` par modèle l'emporte sur celui au niveau du fournisseur en cas de clés en conflit. Contrairement à `providerOptions`, ces instructions n'atteignent jamais le fournisseur — elles réécrivent le corps sur place, ce qui en fait la manière prise en charge de modifier un champ réservé comme `max_tokens`.

Le cas classique est un déploiement de **raisonnement** OpenAI / Azure (série o, GPT-5), qui rejette `max_tokens` et exige `max_completion_tokens`. Si tu marques le modèle comme modèle de raisonnement (en réglant son bouton `reasoning`), Tale applique ce renommage automatiquement — tu n'as alors besoin de `requestBodyMap` que pour d'autres particularités de point de terminaison.

## Le fichier de secrets

`providers/<name>.secrets.json` est un objet JSON plat avec la clé API sous le nom de champ que le fournisseur attend :

```json
{
  "apiKey": "sk-..."
}
```

Avec `SOPS_AGE_KEY` ou `SOPS_AGE_KEY_FILE` défini, ce fichier est stocké chiffré sur disque. Avec les deux non définis, il est en clair au mode 0600 — n'atteins ce mode que sur des disques chiffrés au repos. Le walkthrough de chiffrement complet vit dans [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops).

## Source de clé par variable d'environnement {#environment-variable-key-source}

Si tes secrets vivent déjà dans Kubernetes Secrets, Vault ou un gestionnaire de secrets cloud, tu peux pointer un fournisseur sur une **variable d'environnement** plutôt que sur un fichier de secrets. Ajoute un `secretsEnv` au fichier de config (il nomme la variable ; le nom lui-même n'est pas un secret, il reste donc dans la config committable) :

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "secretsEnv": "TALE_PROVIDER_KEY_OPENROUTER",
  "models": [
    {
      "id": "openai/gpt-4o",
      "displayName": "GPT-4o",
      "tags": ["chat", "vision"],
      "secretsEnv": "TALE_PROVIDER_KEY_OPENAI_DIRECT"
    }
  ]
}
```

Deux garde-fous s'appliquent :

- **Préfixe réservé (obligatoire).** Le nom de la variable doit commencer par `TALE_PROVIDER_KEY_` (par ex. `TALE_PROVIDER_KEY_OPENROUTER`). Tout autre nom est rejeté, donc une config qui nomme une variable sans préfixe se résout à aucune clé. Cela empêche un acteur qui écrit la config de pointer `secretsEnv` sur un secret de déploiement étranger (par ex. `SOPS_AGE_KEY`) et de le faire envoyer à une URL de fournisseur. La barrière de préfixe est codée en dur — il n'y a aucun commutateur de déploiement à définir.
- **Longueur.** Le nom doit faire 40 caractères ou moins — la plateforme synchronise les variables d'environnement vers son backend Convex, qui plafonne les noms de variables à 40.

Ordre de résolution, le plus haut d'abord : `secretsEnv` au niveau modèle → `secretsEnv` au niveau fournisseur → le fichier de secrets (`modelKeys[id]` puis `apiKey`). Chaque palier est sauté quand il ne donne rien, donc une variable configurée mais vide retombe sur le fichier. Les valeurs d'env sont trimmées (un retour à la ligne en queue venant d'un secret monté est une cause fréquente de `401`).

Contrairement au **fichier** de secrets — que le watcher relit à chaque requête — une **valeur** de variable d'environnement est lue une seule fois au démarrage du processus. La changer demande de **redémarrer le conteneur `tale-platform`** (il resynchronise l'env vers Convex au boot). La plateforme synchronise automatiquement la variable vers le backend Convex, donc les actions RAG et crawler en in-process la récupèrent depuis la même synchronisation — il n'y a pas de service séparé à recréer.

## Ajouter un fournisseur

L'ordre compte — le watcher lit le fichier de config d'abord pour savoir que le fournisseur existe, puis résout le secret à la première requête.

1. Dépose le fichier de config à `providers/<name>.json`.
2. Dépose le fichier de secrets à `providers/<name>.secrets.json` (chiffré ou en clair selon ton mode SOPS).
3. Rafraîchis **Paramètres > Fournisseurs** dans l'UI — le nouveau fournisseur apparaît en quelques secondes (le watcher poll toutes les 2 s).
4. Choisis le modèle par défaut du nouveau fournisseur sous **Paramètres > Modèles** pour que les agents qui résolvent "default" y atterrissent.

Si le fichier de config est malformé, la plateforme log un avertissement et saute le fournisseur ; le reste reste joignable.

## Échanger une clé

Édite le fichier de secrets en place — le watcher prend le changement et la prochaine requête à ce fournisseur utilise la nouvelle clé. Les requêtes en vol existantes tiennent encore l'ancienne clé ; annule et réessaie pour forcer la re-résolution. (Les clés issues d'une [variable d'environnement](#environment-variable-key-source) sont l'exception : changer la valeur demande un redémarrage du conteneur, pas seulement une édition de fichier.)

## Désactiver un fournisseur

Soit supprime les deux fichiers, soit mets `"disabled": true` au niveau racine de la config. Désactiver garde le fichier sur disque pour plus tard (pratique quand tu veux garder la liste des modèles mais arrêter la facturation) ; supprimer l'enlève entièrement. Les agents qui ont nommé le fournisseur explicitement commencent à échouer à la prochaine requête — bascule-les sur un fallback d'abord.

## Où cela s'inscrit

Les fournisseurs sont le seul demi-et-demi entre config serveur (cette page) et UI (l'écran **Fournisseurs**). Les clés elles-mêmes vivent dans `providers/*.secrets.json` ; la gestion SOPS vit dans [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops). Les défauts au niveau modèle, contre lesquels les agents résolvent, sont documentés sous [Plateforme > Modèles](/fr/platform/models).

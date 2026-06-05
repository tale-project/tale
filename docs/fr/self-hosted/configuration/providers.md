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
  "displayName": "OpenAI",
  "description": "Whisper + GPT-4o-mini-tts pour le mode voix.",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "transcription": "whisper-1",
    "text-to-speech": "gpt-4o-mini-tts"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

L'ensemble complet des champs vit dans [`examples/default/providers/`](https://github.com/tale-project/tale/tree/main/examples/default/providers) — `openai.json`, `openrouter.json` et `vercel-gateway.json` couvrent les trois formes dont tu auras probablement besoin.

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
  "secretsEnv": "OPENROUTER_API_KEY",
  "models": [
    {
      "id": "openai/gpt-4o",
      "displayName": "GPT-4o",
      "tags": ["chat", "vision"],
      "secretsEnv": "OPENAI_DIRECT_KEY"
    }
  ]
}
```

Deux garde-fous s'appliquent :

- **Allowlist (obligatoire).** Le nom de la variable doit apparaître dans `TALE_PROVIDER_SECRET_ENV_ALLOWLIST` (une liste séparée par des virgules définie sur le déploiement). Une allowlist vide ou non définie désactive entièrement la source par variable d'environnement, donc une config qui ne nomme qu'une variable se résout à aucune clé. Cela empêche un acteur qui écrit la config de pointer `secretsEnv` sur un secret de déploiement étranger (par ex. `SOPS_AGE_KEY`) et de le faire envoyer à une URL de fournisseur.
- **Longueur.** Le nom doit faire 40 caractères ou moins — la plateforme synchronise les variables d'environnement vers son backend Convex, qui plafonne les noms de variables à 40.

Ordre de résolution, le plus haut d'abord : `secretsEnv` au niveau modèle → `secretsEnv` au niveau fournisseur → le fichier de secrets (`modelKeys[id]` puis `apiKey`). Chaque palier est sauté quand il ne donne rien, donc une variable configurée mais vide retombe sur le fichier. Les valeurs d'env sont trimmées (un retour à la ligne en queue venant d'un secret monté est une cause fréquente de `401`).

Contrairement au **fichier** de secrets — que le watcher relit à chaque requête — une **valeur** de variable d'environnement est lue une seule fois au démarrage du processus. La changer demande de **redémarrer le conteneur `tale-platform`** (il resynchronise l'env vers Convex au boot) et de recréer les conteneurs `tale-rag` / `tale-crawler` (ils lisent `os.environ` directement). La variable doit être présente partout où la clé est consommée : la plateforme la synchronise automatiquement vers Convex ; les services Python la reçoivent via leur `env_file` compose.

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

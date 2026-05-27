---
title: Fournisseurs
description: Le format à deux fichiers des fournisseurs sur disque — `<name>.config.json` pour la forme publique, `<name>.secrets.json` pour les clés — plus le workflow pour ajouter, échanger et désactiver un fournisseur de modèle.
---

Tale stocke chaque fournisseur de modèle sous forme de deux fichiers sous `providers/` — un `<name>.config.json` pour la forme publique (URL de base, modèles, capacités) et un `<name>.secrets.json` pour les clés API. La séparation existe pour que la config soit safe à commit et que les secrets reçoivent le traitement chiffré que SOPS leur donne. Le conteneur `tale-platform` lit les deux au boot et les surveille pour les changements ; redémarrer le conteneur n'est pas requis pour prendre en compte des éditions.

La référence est le format de fichier sur disque et l'ordre des opérations à suivre en ajoutant un fournisseur. Le flow piloté par l'UI ("Paramètres > Fournisseurs") s'assied sur les mêmes fichiers ; les deux produisent des résultats identiques.

## Le fichier de config

`providers/<name>.config.json` décrit la forme publique du fournisseur. Le `displayName` apparaît dans l'UI, le tableau `models` nomme tout ce qui est joignable via ce fournisseur, et chaque modèle déclare ses tags (`chat`, `vision`, `embedding`, `transcription`, `text-to-speech`).

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

## Ajouter un fournisseur

L'ordre compte — le watcher lit le fichier de config d'abord pour savoir que le fournisseur existe, puis résout le secret à la première requête.

1. Dépose le fichier de config à `providers/<name>.config.json`.
2. Dépose le fichier de secrets à `providers/<name>.secrets.json` (chiffré ou en clair selon ton mode SOPS).
3. Rafraîchis **Paramètres > Fournisseurs** dans l'UI — le nouveau fournisseur apparaît en quelques secondes (le watcher poll toutes les 2 s).
4. Choisis le modèle par défaut du nouveau fournisseur sous **Paramètres > Modèles** pour que les agents qui résolvent "default" y atterrissent.

Si le fichier de config est malformé, la plateforme log un avertissement et saute le fournisseur ; le reste reste joignable.

## Échanger une clé

Édite le fichier de secrets en place — le watcher prend le changement et la prochaine requête à ce fournisseur utilise la nouvelle clé. Les requêtes en vol existantes tiennent encore l'ancienne clé ; annule et réessaie pour forcer la re-résolution.

## Désactiver un fournisseur

Soit supprime les deux fichiers, soit mets `"disabled": true` au niveau racine de la config. Désactiver garde le fichier sur disque pour plus tard (pratique quand tu veux garder la liste des modèles mais arrêter la facturation) ; supprimer l'enlève entièrement. Les agents qui ont nommé le fournisseur explicitement commencent à échouer à la prochaine requête — bascule-les sur un fallback d'abord.

## Où cela s'inscrit

Les fournisseurs sont le seul demi-et-demi entre config serveur (cette page) et UI (l'écran **Fournisseurs**). Les clés elles-mêmes vivent dans `providers/*.secrets.json` ; la gestion SOPS vit dans [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops). Les défauts au niveau modèle, contre lesquels les agents résolvent, sont documentés sous [Plateforme > Modèles](/fr/platform/models).

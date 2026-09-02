---
title: Secrets avec SOPS
description: Comment Tale chiffre les clés de fournisseurs sur disque avec SOPS et age, les trois modes de stockage et le walk complet de rotation de clé.
---

Tale stocke les clés API des fournisseurs dans des fichiers `providers/*.secrets.json` sur disque. Le mode par défaut après `tale init` chiffre ces fichiers avec SOPS en utilisant une clé age ; un mode alternatif lit plusieurs clés depuis un fichier (le chemin de rotation) ; un troisième mode garde les fichiers en clair au mode 0600 pour les environnements où le disque est chiffré au repos et où la rotation est gérée en externe. Cette page est le walkthrough opérateur des trois modes et du chemin de rotation sûr.

Les variables d'env qui pilotent les modes sont `SOPS_AGE_KEY` et `SOPS_AGE_KEY_FILE` — leurs lignes de référence vivent dans [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference#provider-secrets-encryption). Cette page est la version plus longue.

## Les trois modes

| Mode            | Variables d'env                    | Quand utiliser                                                    |
| --------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Clé age inline  | `SOPS_AGE_KEY=AGE-SECRET-KEY-1...` | Défaut après `tale init`. Hôte unique, clé unique.                |
| Fichier de clés | `SOPS_AGE_KEY_FILE=/path/to/keys`  | Requis pour la rotation. Une clé age par ligne, commentaires `#`. |
| Clair à 0600    | Les deux non définis               | Disque chiffré au repos, ou outillage externe écrit les fichiers. |

Le conteneur plateforme choisit le mode au boot. La forme inline est la plus simple ; la forme fichier est la seule qui supporte plusieurs lecteurs (ce qui rend la rotation possible sans downtime) ; la forme en clair saute SOPS entièrement et fait confiance au système de fichiers.

## Mode chiffré au premier boot

`tale init` génère une paire de clés age et écrit la moitié privée dans `SOPS_AGE_KEY` de ton `.env`. Les fichiers de secret de fournisseur écrits via **Paramètres > Fournisseurs** sont chiffrés à la sauvegarde :

```bash
# Inspecte — le fichier est du JSON SOPS-chiffré, pas la clé API en clair
cat providers/openai.secrets.json
# {
#   "apiKey": "ENC[AES256_GCM,data:...,iv:...,tag:...]",
#   "sops": { ... }
# }
```

Le déchiffrement se passe in-process quand le conteneur plateforme lit le fichier. La clé age ne quitte jamais la mémoire du conteneur plateforme.

## Faire tourner la clé age

La rotation est le seul chemin que la forme inline ne couvre pas — seul `SOPS_AGE_KEY_FILE` te laisse accepter du ciphertext lisible par l'ancienne et la nouvelle clé pendant le cutover. Le walk :

```bash
# 1. Génère une nouvelle clé age
age-keygen -o /etc/tale/age-keys.txt

# 2. Ajoute la nouvelle clé comme deuxième ligne dans le fichier
echo "AGE-SECRET-KEY-1NEW..." >> /etc/tale/age-keys.txt

# 3. Pointe .env sur le fichier et redémarre le conteneur plateforme
sed -i 's|^SOPS_AGE_KEY=.*|# SOPS_AGE_KEY=|' .env
sed -i 's|^# SOPS_AGE_KEY_FILE=.*|SOPS_AGE_KEY_FILE=/etc/tale/age-keys.txt|' .env
docker compose restart platform backend-api backend-worker
```

Maintenant l'ancienne et la nouvelle clé peuvent déchiffrer les fichiers existants. Re-sauvegarde la clé API de chaque fournisseur sous **Paramètres > Fournisseurs** — chaque sauvegarde produit du ciphertext lisible par les deux clés. Une fois que chaque fournisseur a été re-sauvegardé (la colonne **Dernière rotation** dans le tableau des fournisseurs te dit lesquels tiennent encore l'ancien ciphertext), retire l'ancienne clé du fichier :

```bash
# 4. Drop la ligne de l'ancienne clé et redémarre à nouveau
sed -i '/^AGE-SECRET-KEY-1OLD/d' /etc/tale/age-keys.txt
docker compose restart platform backend-api backend-worker
```

L'ordre est porteur : ne retire jamais l'ancienne clé avant que chaque fichier soit re-chiffré, sinon le conteneur plateforme échouera à lire les fichiers encore-anciens au prochain déchiffrement.

## Basculer en clair

Quand le disque hôte est chiffré au repos (LUKS, chiffrement AWS EBS, GCP CSEK) et que tu ne veux pas d'une deuxième couche de gestion de clés, le mode en clair est l'option supportée. Commente `SOPS_AGE_KEY` et `SOPS_AGE_KEY_FILE`, redémarre et re-sauvegarde chaque fournisseur — les fichiers sont maintenant du JSON au mode 0600.

Le modèle de risque change : un dump de système de fichiers leaké est maintenant un dump de credentials leaké. Choisis ce mode seulement quand le chiffrement de disque est réel (pas une case à cocher) et audite l'histoire de backup de l'hôte pour confirmer qu'aucun snapshot en clair n'échappe.

## Stores de secret externes

Quand tes clés vivent déjà dans Vault, un gestionnaire de secrets cloud ou Kubernetes Secrets, le pattern de première classe est la source de clé par variable d'environnement : pointe chaque fournisseur sur une **variable d'environnement** avec `secretsEnv` et laisse ton store de secrets remplir cette variable. Aucun fichier en clair ne touche le disque, et la barrière de préfixe empêche un acteur qui écrit la config de lire un secret de déploiement étranger. Le mécanisme complet — la barrière de préfixe `TALE_PROVIDER_KEY_`, l'ordre de résolution et le comportement de redémarrage au changement — vit dans [Fournisseurs](/fr/self-hosted/configuration/providers#environment-variable-key-source).

L'approche par mount de fichier est l'alternative legacy : écris les fichiers `*.secrets.json` en clair depuis le store externe et fais tourner Tale en mode clair. Cela fonctionne toujours, mais pose la clé en clair sur le disque et casse si tu sauvegardes un fournisseur via l'UI — l'UI écrase le mount. Préfère la source par variable d'environnement, sauf si une contrainte impose la forme fichier.

## Où cela s'inscrit

Cette page est le guide opérateur complet de la couche SOPS ; les lignes de référence de variables d'env sont dans [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference#provider-secrets-encryption), et le format des fichiers fournisseur lui-même dans [Fournisseurs](/fr/self-hosted/configuration/providers). Si une clé est leakée, la rotation est le même walk ci-dessus exécuté en urgence.

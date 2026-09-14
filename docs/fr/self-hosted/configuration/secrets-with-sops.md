---
title: Protéger les secrets de configuration avec SOPS
description: Distingue le chiffrement des fichiers de celui de la base et change les clés age sans perdre l’accès.
---
Tale utilise SOPS et age pour les fichiers de secrets de configuration compatibles, notamment les connexions à la base documentaire et au stockage objet. Les identifiants actuels des fournisseurs AI sont stockés séparément dans la base applicative et utilisent `ENCRYPTION_SECRET_HEX`. Changer une clé age ne modifie pas ces identifiants.

## Identifier le secret concerné

Le mode de stockage détermine la clé à utiliser :

| Stockage du secret | Clé de chiffrement | Conséquence opérationnelle |
| --- | --- | --- |
| Fichier de configuration `*.secrets.json` compatible SOPS | `SOPS_AGE_KEY` ou `SOPS_AGE_KEY_FILE` | Conserve une clé capable de déchiffrer chaque fichier et sauvegarde retenus. |
| Identifiants de fournisseurs et autres valeurs Secret Box en base | `ENCRYPTION_SECRET_HEX` | Remplacer la clé rend les données chiffrées illisibles ; une rotation age ne les migre pas. |
| Identifiant de fournisseur issu d’une variable d’environnement | `TALE_PROVIDER_KEY_*` | Change le secret dans le gestionnaire du déploiement et redémarre ses consommateurs. |

Un ancien fichier `providers/<name>.secrets.json` peut subsister dans une configuration historique. Sa présence ne signifie pas que les identifiants actuels l’utilisent. Consulte [Fournisseurs](/fr/self-hosted/configuration/providers) pour le modèle actuel.

## Choisir une source de clé age

Une valeur directe `SOPS_AGE_KEY` prime sur `SOPS_AGE_KEY_FILE`. Choisis explicitement une source. Le fichier accepte une clé privée age par ligne et ignore les lignes vides et les commentaires `#`. Tale inclut tous les destinataires configurés lorsqu’il chiffre un nouveau fichier SOPS.

Le chemin est résolu depuis le processus qui lit le fichier. Un chemin hôte dans `.env` ne suffit pas : monte le fichier dans chaque conteneur concerné, indique son chemin interne et restreins l’accès. Recrée les conteneurs après une modification de leur environnement ; `docker compose restart` ne recharge pas les définitions modifiées.

Si les deux variables sont absentes, le module SOPS écrit les fichiers compatibles en JSON non chiffré avec les permissions `0600`. Il reconnaît toujours les fichiers déjà chiffrés et refuse de les lire sans clé. Retirer les variables ne déchiffre aucun fichier existant.

## Préparer une rotation

Inventorie les fichiers SOPS et leurs sauvegardes avant de remplacer une clé. Garde une copie protégée de l’ancienne clé et vérifie le déchiffrement d’un fichier représentatif sans afficher son contenu ni l’envoyer dans les logs.

Crée une nouvelle clé age avec tes outils habituels de gestion des secrets. Prépare un fichier protégé contenant **l’ancienne clé privée et la nouvelle**. N’écrase pas l’ancien fichier avec une commande qui ne génère que la nouvelle clé.

Monte ce fichier dans le déploiement et utilise `SOPS_AGE_KEY_FILE`. Retire la valeur directe de l’environnement des processus concernés, sinon elle reste prioritaire. Déploie le changement et vérifie que les connexions existantes fonctionnent.

## Rechiffrer et vérifier

Réécris chaque fichier concerné par son mécanisme de sauvegarde pris en charge ou par une procédure SOPS contrôlée. Tale chiffre les nouveaux fichiers pour tous les destinataires configurés. Ajouter une clé ne modifie pas les fichiers existants.

<Warning>

Ne retire pas l’ancienne clé avant d’avoir vérifié chaque fichier actif avec la nouvelle clé seule. Conserve l’ancienne clé sous protection pour les sauvegardes historiques qui en ont encore besoin.

</Warning>

Déploie ensuite un fichier qui ne contient que la nouvelle clé. Redémarre les processus concernés pour vider les caches déchiffrés, puis teste chaque connexion. Le démarrage d’un processus ne prouve pas à lui seul que tous les fichiers sont lisibles.

## Résoudre un échec de déchiffrement

| Symptôme | Vérification |
| --- | --- |
| Un fichier chiffré est trouvé sans clé | Rétablis la clé correspondante ; désactiver le chiffrement ne convertit pas le fichier. |
| La lecture du fichier de clés échoue | Vérifie le montage, le chemin interne, le propriétaire et les permissions. |
| L’ancienne clé reste sélectionnée | Retire la valeur non vide de `SOPS_AGE_KEY` avant d’utiliser le fichier. |
| La nouvelle clé ne lit pas un fichier | Conserve l’ancienne clé et rechiffre ce fichier avant de terminer la rotation. |
| Un fournisseur échoue après modification de `ENCRYPTION_SECRET_HEX` | Rétablis l’accès aux secrets en base ; changer les clés age ne les répare pas. |

Pour les secrets gérés par Vault, Kubernetes ou un autre service externe, privilégie la [source par variable d’environnement](/fr/self-hosted/configuration/providers) lorsqu’elle est disponible. Conserve les clés avec ton plan de reprise, sous une protection distincte des sauvegardes qu’elles déchiffrent.

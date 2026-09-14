---
title: Publier les configurations d’un client
description: Créer, vérifier et déployer un paquet d’automatisation versionné depuis un repository client avec la CLI Tale, puis vérifier les octets du workflow et des skills natifs.
---

Une release de configuration installe un workflow vérifié et ses propres skills dans une organisation et un projet existants. Son identité est le commit source complet. Suis ce parcours si l’application reste en place ; utilise les [déploiements gérés](/fr/self-hosted/install/cli-install) pour une nouvelle instance ou un changement d’environnement d’exécution.

## Comprendre le résultat de chaque commande

| Commande | Résultat à vérifier avant de continuer |
| --- | --- |
| `config build` | Manifeste et archives compilées depuis une révision source committée. |
| `config verify --rebuild` | Une reconstruction indépendante correspond aux artefacts examinés. |
| `config stage` | Dossier transférable contenant uniquement les fichiers de déploiement et leur inventaire de hashes. |
| `config deploy` | Workflow et skills propres installés, relus et enregistrés dans un reçu persistant. |
| `config verify-native` | Comparaison en lecture seule avec le contenu actuellement installé. |

Un ID ou une session **native** appartient ici à l’instance Tale cible. Un **reçu** décrit le résultat d’un déploiement ; il ne remplace pas la vérification du serveur actuel. Valider le format et les octets ne prouve pas le résultat métier de l’automatisation : conserve les tests métier dans le dépôt client.

## Avant de commencer

Installe la [CLI Tale](/fr/self-hosted/install/cli-install) et fixe une révision qui prend en charge le format des paquets et les API du serveur cible. Les commandes de configuration désignent explicitement la source et la destination. Elles ne nécessitent ni `tale.json` local, ni contexte Docker, ni dossier source Tale voisin. Le parseur et le validateur intégrés vérifient les champs pris en charge, sans ajouter les fonctions d’un serveur plus récent à une ancienne instance.

Il te faut un descripteur et un paquet committés, une organisation et un projet existants, ainsi qu’une session native autorisée. Si le paquet possède ses propres skills, utilise l’ID natif de cet opérateur comme propriétaire du build. Cet ID est distinct de ceux du projet, de l’organisation et d’une identité externe.

Pour une instance neuve sans ID natifs, utilise un déploiement géré avec une nouvelle identité explicite, un projet symbolique et `skillOwner: "operator"`. Il transfère des sources vérifiées et compile après avoir prouvé l’opérateur natif ; les commandes de version autonomes exigent toujours des ID résolus. Garde la configuration métier dans l’arbre source du client. Les paramètres de modèles externes appartiennent à la déclaration de déploiement.

Les exemples utilisent le client synthétique `example-team` et l’automatisation `document-review`. Injecte le cookie complet de session dans `TALE_CONFIG_COOKIE` depuis ton gestionnaire de secrets. Garde-le hors des arguments, sources, archives, reçus et logs.

## Committer le descripteur et le paquet

Place le descripteur dans `tale/client.json`, les paquets sous `tale/packs/` et les tests métier à côté. Conserve aussi les éventuels catalogues de releases historiques à cet endroit. Les chemins du descripteur sont relatifs à son propre répertoire.

Ajoute `.tale/` au `.gitignore` du client si cette entrée manque. Les builds par défaut y conservent l’état des verrous locaux ; les commandes avec une sortie explicite se coordonnent à côté de cette sortie. La configuration maintenue utilise `tale/` sans point.

```json
{
  "schemaVersion": 1,
  "clientId": "example-team",
  "sourceRepository": "https://github.com/example-team/client-app",
  "automations": [
    {
      "name": "document-review",
      "displayName": "Document review",
      "packPath": "packs/document-review",
      "releasesPath": "releases/document-review",
      "logicalSkillSlugs": ["record-check"],
      "requiredExternalSkills": []
    }
  ]
}
```

`logicalSkillSlugs` nomme les répertoires de skills fournis par ce paquet. `requiredExternalSkills` nomme les dépendances déjà installées dans Tale : la CLI vérifie leur présence, mais cette release ne fixe pas leurs octets. Garde les identifiants, hôtes cibles et ID de projets dans la déclaration de déploiement. Committe le descripteur et le paquet ; le compilateur lit les objets Git, pas les modifications non committées.

## Construire et vérifier le commit source

Définis `CONFIG_REPO` avec le dossier source, `CONFIG_SOURCE_COMMIT` avec le commit source complet de 40 caractères et `TALE_NATIVE_USER_ID` avec l’ID natif de l’opérateur. Choisis un nouveau répertoire absolu `CONFIG_BUILD` hors du dossier source. Ces commandes construisent la release et reconstruisent ses octets indépendamment.

```bash
tale --json config build \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --source-commit "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --output "$CONFIG_BUILD"

tale --json config verify \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --manifest "$CONFIG_BUILD/$CONFIG_SOURCE_COMMIT.json" \
  --rebuild
```

Le manifeste par défaut utilise le schéma 4/compilateur 3. Il enregistre `releaseRef` égal à `sourceCommit`, l’arbre du paquet, le hash du descripteur et l’inventaire compilé complet. La sortie contient le ZIP canonique, un ZIP par skill propre au paquet et un ZIP d’installation du workflow seul. Les slugs des skills portent le SHA source complet ; les métadonnées du compilateur préservent leur identité logique. Les octets complets incluent le propriétaire déclaré. Changer ce propriétaire exige un nouveau commit source et une nouvelle release.

Exige des octets identiques lors de la reconstruction et lance les tests métier du client sur le ZIP canonique extrait. Conserve les artefacts vérifiés et relève `artifactSha256` dans `CONFIG_ARTIFACT_SHA256`. La validation du format natif prouve que le paquet peut être interprété ; elle ne valide pas ses résultats métier. Un nouveau déploiement fondé sur les sources ne nécessite aucun commit supplémentaire des fichiers générés.

## Préparer le dossier de transfert

Utilise un dossier source dont `HEAD` correspond à `CONFIG_SOURCE_COMMIT`. Définis `CONFIG_STAGE` avec un nouveau répertoire absolu hors de ce dossier source. L’option `DEPLOYMENT_COMMIT` enregistre le commit complet de ta déclaration de déploiement ; omets `--deployment-ref` si tu n’en suis pas.

```bash
tale --json config stage \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --client example-team \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$CONFIG_STAGE"
```

La préparation construit le descripteur et le paquet committés, vérifie les archives indépendamment et rassemble uniquement les fichiers autorisés avec un inventaire de leurs hashes. Les modifications non committées n’y entrent pas. Compare le hash de l’artefact au build vérifié. Transfère le répertoire comme une unité complète ; la destination native n’a besoin ni du dossier source client ni de son identifiant Git.

Fixe l’URL du dépôt client, le SHA source complet, la révision de CLI et, si nécessaire, celle du déploiement. La provenance dépend aussi de ton dossier source de confiance : une URL dans le descripteur ne prouve pas quel remote a fourni un objet Git local.

## Déployer et relire le résultat

Définis `TALE_CONFIG_URL`, `TALE_CONFIG_ORIGIN`, `TALE_ORG_ID` et `TALE_PROJECT_ID` avec la destination native approuvée. Conserve `CONFIG_RECEIPT` sur un stockage persistant. Après examen des fichiers préparés, fournis `--yes` pour un déploiement sans interaction déjà autorisé, puis lance une vérification séparée en lecture seule. Utilise la même référence de déploiement optionnelle que pour la préparation.

```bash
tale --json --yes config deploy \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --receipt "$CONFIG_RECEIPT" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json config verify-native \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

L’URL cible désigne l’API accessible ; l’origine est celle du navigateur, y compris quand l’API utilise une adresse locale derrière un proxy. L’ID natif connecté doit correspondre au propriétaire des skills déclaré.

Le déploiement crée les skills manquants par le téléversement natif réservé à la création et vérifie chaque octet installé. Il réutilise des octets existants identiques et refuse tout contenu différent sous le même slug de release. L’import du workflow seul ne peut écrire aucun skill. Avant d’annoncer le succès, la CLI vérifie le workflow déployé, les paramètres, la présentation, le contrat de tâche et le lien au projet.

Lance `verify-native` après le déploiement et les tests d’exploitation. Cette commande n’importe rien et ne crée ni version ni reçu. Un déploiement répété relit aussi le contenu natif avant de signaler une release inchangée. Un reçu conservé ne prouve pas, à lui seul, les octets actuels.

## Reprendre un déploiement interrompu

Conserve le dossier exact de transfert et le reçu pendant l’enquête. Choisis la suite selon l’état indiqué par la CLI :

| État | Prochaine étape sûre |
| --- | --- |
| Un reçu fiable enregistre une progression partielle | Relance avec le même dossier, la même cible et le même reçu. Les skills identiques peuvent être réutilisés. |
| Une version correspondante est déjà déployée | Relis-la avec `verify-native`. Un nouveau déploiement vérifie aussi avant d’annoncer l’absence de changement. |
| Réponse d’import perdue, seule une version non publiée est visible | Arrête et examine. L’API native ne peut pas lire son contrat de tâche complet avant déploiement ; la CLI ne peut donc pas prouver qu’elle peut la réutiliser. |
| Un slug de skill de release contient d’autres octets | Préserve les indices et identifie la release ou la modification en conflit. N’écrase pas le contenu pour faire réussir la vérification. |
| Le reçu est illisible ou désigne une autre cible | Récupère le bon reçu ou résous l’écart avant de relancer. N’invente jamais un reçu de réussite. |

Coordonne les déploiements vers la même cible. Le verrou local n’empêche ni un autre hôte ni un administrateur de modifier le contenu natif. Après reprise, relance les vérifications métier du client et la comparaison native indépendante.

## Reconstruire une release historique

Les releases sémantiques existantes restent compatibles : `build --config-version` choisit le schéma 3/compilateur 2 ; `stage --config-version` utilise le catalogue committé et ses références explicites de catalogue et d’ops. Garde les manifestes et archives d’origine intacts. Un descripteur peut enregistrer des snapshots source historiques avec leurs sommes de contrôle pour une reconstruction hors ligne ; seuls les champs pris en charge par ce format sont vérifiables. Les anciens skills partagés ne sont réutilisables que si cela est explicitement autorisé et que leurs octets sont déjà identiques. Restaure un contenu historique différent par une nouvelle release.

La reconstruction historique demande des outils supplémentaires. Le schéma 1 utilise Git `archive --mtime` ; vérifie que ton Git prend cette option en charge. Le schéma 2/compilateur 1 utilise la bibliothèque standard de Python 3. Le schéma 3/compilateur 2, le schéma 4/compilateur 3 et le déploiement natif n’ont pas besoin de Python.

Conserve ensemble sources, tests métier, archives vérifiées, révision de CLI, références de déploiement et reçu. Les cookies de session et identifiants restent dans ton gestionnaire de secrets, hors de ces artefacts. [Mises à niveau](/fr/self-hosted/operate/upgrades) et [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) couvrent la reprise de l’application et de ses données.

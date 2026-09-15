---
title: Architecture auto-hébergée
description: Comprends les services applicatifs, le stockage et les sandbox avant de choisir comment déployer et exploiter Tale.
---

Avec Tale auto-hébergé, tu exploites l’application, son stockage et les services de sandbox sur ton infrastructure. Une instance peut accueillir plusieurs organisations ; les données et la configuration de chacune restent rattachées à cette organisation.

Cette vue d’ensemble aide à prévoir la capacité et à choisir les données à sauvegarder. [Gérer Compose toi-même](/fr/self-hosted/install/own-compose) décrit les réseaux, montages et sondes nécessaires. [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) aide à localiser une panne sur une instance en service.

## Comment les services s’articulent

Le déploiement fourni pour un hôte comprend dix services, sans compter les réplicas ni les sessions temporaires de sandbox. Le stack de développement peut utiliser une base de connaissances séparée. Pour comparer ces installations, regarde le rôle des services plutôt que le nombre de conteneurs.

| Couche | Services | Responsabilité |
| --- | --- | --- |
| Entrée publique | `proxy` | Caddy termine TLS et dirige les requêtes du navigateur vers l’interface, les API et le stockage de fichiers. |
| Application | `platform`, `backend-api`, `backend-worker` | Le service web fournit l’interface. L’API authentifie les requêtes et traite les opérations applicatives. Les workers exécutent les tâches, automatisations et imports en file d’attente. |
| Stockage persistant | `db`, `object-store` | Postgres conserve les données applicatives et les connaissances ; le stockage compatible S3 contient les fichiers d’origine et les médias générés. |
| Exécution en sandbox | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Le spawner crée les sessions d’exécution, le proxy de sortie contrôle les requêtes réseau et la passerelle de modèles fournit un accès limité aux modèles. |
| Prise en charge vidéo | `bgutil-provider` | Fournit des jetons de preuve d’origine pour l’ingestion vidéo. Sa disponibilité peut affecter la récupération des transcriptions. |

Le navigateur passe par le proxy public. Les ports internes des bases, de la passerelle et des sandbox ne doivent pas être exposés comme services publics. Avec un bucket externe, les requêtes de fichiers présignées peuvent aller directement du navigateur à son point d’accès public.

Les rôles applicatifs utilisent la même image Tale Platform. `TALE_ROLE=api` démarre l’API et `TALE_ROLE=worker` un worker. Les workers n’exposent pas de serveur HTTP. L’environnement d’exécution des sandbox est une image distincte qui sert à créer des conteneurs de session temporaires, pas un service Compose permanent de plus.

## Où les données persistent

| Emplacement dans le stack fourni | Données à conserver |
| --- | --- |
| `db-data` | `tale_app` : utilisateurs, chats, exécutions, entrées d’audit et secrets chiffrés en base. `tale_knowledge` : contenu extrait, embeddings, index de recherche et pages web récupérées. |
| `config-data` | Fichiers de configuration des organisations : agents, skills, définitions de fournisseurs, règles de gouvernance, SSO et identité visuelle. |
| `object-store-data` | Documents importés, pièces jointes, audio et fichiers générés. |
| `caddy-data`, `caddy-config` | Certificats et état du proxy. |
| `llm-gateway-data` | Configuration de la passerelle et état des accès de session. |

Le stack fourni place les deux bases dans un seul service Postgres et expose la connexion aux connaissances sous l’alias réseau `knowledge-db`. Les bases restent distinctes. Un déploiement Compose depuis les sources avec un service de connaissances séparé possède aussi `knowledge-db-data`.

Remplacer un conteneur ne préserve les données que si ses volumes persistants ou ses stockages externes restent raccordés. Conserve aussi le dossier de déploiement, l’environnement, les clés de chiffrement et des sauvegardes hors de l’hôte. Les snapshots de la CLI ne couvrent pas tous les volumes ci-dessus ; vérifie leur portée dans [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore).

## Secrets et connexion

`ENCRYPTION_SECRET_HEX` protège les identifiants des fournisseurs et les autres valeurs chiffrées dans la base applicative. SOPS et age protègent les fichiers de secrets associés aux configurations prises en charge, comme les mots de passe des stockages externes. Sauvegarde les clés nécessaires séparément des données qu’elles protègent : une nouvelle clé ne déchiffre pas les secrets existants.

Better Auth fonctionne dans le backend. Connexion locale, authentification à deux facteurs, passkeys, SSO d’entreprise et authentification par en-têtes de confiance ont des prérequis différents. [Authentification](/fr/self-hosted/configuration/authentication) explique leur mise en place ; [Membres et rôles](/fr/platform/admin/members-and-roles) décrit les droits dans l’organisation.

## Prévoir la capacité et l’isolation

Les rôles applicatifs acceptent plusieurs réplicas. La CLI les met à jour comme un groupe utilisant la même version. Pendant une mise à niveau, les anciens et nouveaux groupes coexistent : prévois la capacité nécessaire à ce chevauchement. La base, le stockage objet et les services de sandbox demandent leur propre plan de capacité et de reprise.

Tu peux déplacer la base applicative, la base de connaissances ou les fichiers vers une infrastructure externe. Une organisation peut aussi choisir sa propre base de connaissances et son bucket. Changer une connexion ne transfère pas le contenu existant. Prépare la copie, la bascule, les vérifications et les sauvegardes avec [Résidence des données](/fr/self-hosted/configuration/data-residency).

L’auto-hébergement détermine où Tale fonctionne. Les appels aux fournisseurs, connecteurs, récupérations web et accès réseau des sandbox dépendent toujours de ta configuration. Examine ces destinations avec les emplacements de stockage dans [Durcissement](/fr/self-hosted/operate/security/hardening).

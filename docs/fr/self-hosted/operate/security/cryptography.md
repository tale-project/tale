---
title: Cryptographie et gestion des clés
description: Identifie les clés de chiffrement, de session et d’audit dont dépend ton déploiement et prépare leur récupération.
---
Cet inventaire indique quelle clé protège chaque donnée et ce qui se passe lorsqu’elle change. Les secrets applicatifs, volumes de bases, échanges réseau et preuves d’audit ont des protections distinctes. Garde cette distinction lorsque tu prépares une sauvegarde ou examines un déploiement.

## Identifier les données chiffrées

Les identifiants actuels des fournisseurs utilisent la Secret Box de la base : AES-256-GCM avec une clé dédiée dérivée de `ENCRYPTION_SECRET_HEX` par HKDF-SHA256. D’autres identifiants en base, dont les tokens OAuth de connectors, peuvent utiliser le format JWE `dir`/`A256GCM` fondé sur la même racine de déploiement. Ces formats ne sont pas interchangeables.

Les fichiers de secrets de configuration compatibles utilisent SOPS avec des destinataires age, notamment pour les bases documentaires et le stockage objet externes. `SOPS_AGE_KEY` ou `SOPS_AGE_KEY_FILE` configure ce chiffrement ; sans ces variables, le module accepte des fichiers en clair avec des permissions restreintes. Lis [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) avant de changer ce réglage.

Les noms, adresses, conversations et documents ne bénéficient pas d’un chiffrement systématique par champ via ces mécanismes. Protège la base, le stockage objet et les sauvegardes avec le chiffrement du stockage et les accès requis pour ton installation. TLS protège les échanges, pas un fichier de base copié depuis le disque.

## Protéger les échanges réseau

Le reverse proxy public termine les connexions HTTPS. Configure le domaine et le certificat avec [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains), puis vérifie le certificat et les versions TLS acceptées sur l’endpoint déployé.

Le réseau Docker interne sépare les services, mais ne chiffre pas lui-même les échanges avec TLS. Si une connexion à une base, un stockage ou un autre service traverse des hôtes ou des limites de confiance, configure et vérifie aussi sa protection de transport.

## Préserver les mots de passe et sessions

Les mots de passe locaux sont hachés avec bcrypt. `BETTER_AUTH_SECRET` protège l’état d’authentification ; conserve une valeur stable et identique entre les réplicas backend. Un changement peut invalider les sessions et interrompre les connexions en cours.

Un fournisseur d’identité possède ses propres clés de signature et sa propre procédure de rotation. Enregistre ses métadonnées et certificats actuels via le [SSO d’entreprise](/fr/platform/admin/enterprise-sso). Changer un secret de session Tale ne change pas une clé de l’IdP.

## Vérifier les preuves d’audit

Les entrées d’audit forment une chaîne SHA-256. Le vérificateur PostgreSQL actuel contrôle les lignes conservées et leurs liens, à partir du premier lien encore stocké. Il tient compte de la conservation et rapproche les lignes effacées des demandes d’effacement. Il ne vérifie pas de points de contrôle signés et n’utilise pas `TALE_AUDIT_SIGNING_KEY` comme ancrage de confiance indépendant.

La chaîne rend une altération détectable ; elle ne rend pas le stockage inviolable. Protège l’accès à la base, conserve les preuves indépendamment si nécessaire et examine les alertes avec [Intégrité du journal d’audit](/fr/self-hosted/operate/security/audit-log-integrity). La variable distincte `TALE_AUDIT_PEPPER` pseudonymise les identifiants sensibles des connexions échouées. Sa rotation modifie la corrélation de part et d’autre de ce changement.

## Préparer la récupération des clés

Utilise ce tableau pour ton plan de restauration :

| Protection | Éléments à conserver | Conséquence d’un changement ou d’une perte |
| --- | --- | --- |
| Secrets chiffrés en base | `ENCRYPTION_SECRET_HEX` correspondant au snapshot | Les identifiants existants peuvent devenir illisibles. |
| Fichiers SOPS | Clés privées age correspondantes, y compris pour les anciennes sauvegardes | Un fichier chiffré uniquement pour un destinataire perdu ne peut plus être lu. |
| Authentification | `BETTER_AUTH_SECRET` et configuration cohérente | Les sessions et connexions en cours peuvent échouer. |
| Vérification d’audit | Lignes conservées, demandes d’effacement et preuves indépendantes | La chaîne actuelle ne suffit pas à établir un historique perdu ou réécrit. |
| Chiffrement de l’hôte et du stockage géré | Éléments de récupération et accès du fournisseur de stockage | Les clés applicatives seules ne déverrouillent pas un volume ou un bucket. |

Conserve les clés dans un gestionnaire de secrets ou un espace de reprise protégé, séparé des sources et artefacts publics. Garde les anciennes clés pour les anciennes sauvegardes après la rotation active. Teste une restauration avec les vraies clés dans un environnement isolé.

Les certifications et documents d’assurance sont décrits dans [Confiance et conformité](/fr/cloud/trust-and-compliance). Cet inventaire explique les protections techniques ; évalue aussi la configuration de ta propre installation.

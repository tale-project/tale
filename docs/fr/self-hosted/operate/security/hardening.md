---
title: Sécuriser un déploiement de production
description: Protège l’accès à l’hôte, le réseau, les secrets et la restauration avant d’ouvrir Tale aux utilisateurs.
---

Vérifie ces protections avant le lancement et après toute modification de l’hôte, du réseau ou de l’authentification. Il te faut un accès opérateur et un moyen de récupération qui reste disponible pendant les changements de règles d’accès.

## Restreindre l’administration de l’hôte

Utilise des comptes opérateur nominatifs, des clés SSH et un système d’exploitation pris en charge et à jour. Limite l’accès à l’hôte, au répertoire de configuration, aux sauvegardes et au socket Docker aux personnes responsables du déploiement.

L’appartenance au groupe `docker` donne des capacités de niveau root via le daemon Docker. Exécuter la CLI avec un autre compte ne supprime pas ces pouvoirs. Traite l’accès à Docker comme une administration privilégiée, conformément à la [documentation Docker](https://docs.docker.com/engine/install/linux-postinstall/).

## Vérifier l’exposition publique

Autorise les ports publics prévus pour le proxy et limite les accès administratifs aux sources de confiance. Garde la base, l’administration du stockage, les services internes du backend et la sandbox hors du réseau public, sauf architecture particulière examinée séparément.

Inspecte les ports publiés par ta configuration Compose réelle et teste leur accessibilité depuis l’extérieur de l’hôte. Les règles du pare-feu de l’hôte ne suffisent pas toujours : Docker gère ses propres règles de transfert et de publication des ports. Consulte les [instructions Docker sur les pare-feu](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Si tu utilises l’authentification par en-têtes de confiance, seul le proxy amont doit pouvoir joindre l’application. Il doit supprimer les en-têtes d’identité fournis par l’appelant avant de définir les siens. Voir [Authentification](/fr/self-hosted/configuration/authentication).

## Vérifier TLS à l’adresse publique

Utilise un certificat de confiance pour l’adresse réellement ouverte par les utilisateurs. Choisis `TLS_MODE=letsencrypt` pour le point d’entrée TLS public fourni, ou `TLS_MODE=external` si ton proxy amont termine TLS. Un certificat local autosigné n’établit pas une confiance publique.

Vérifie la chaîne de certificats, l’expiration et le renouvellement, puis teste la connexion et les retours d’authentification à l’adresse publique. [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) explique la configuration.

## Protéger secrets et clés

Remplace les valeurs d’exemple avant la production. Chaque déploiement doit avoir son propre mot de passe de base, ses secrets d’authentification et sa clé de chiffrement. Réserve l’accès à `.env` et aux fichiers secrets à l’opérateur. Conserve les copies de récupération dans ton système de gestion des secrets.

Utilise [SOPS](/fr/self-hosted/configuration/secrets-with-sops) pour les fichiers secrets pris en charge lorsque cela convient à ton installation. SOPS ne chiffre pas toutes les données applicatives ni le disque entier. Conserve les clés nécessaires aux sauvegardes retenues. Prépare les rotations avec [Cryptographie](/fr/self-hosted/operate/security/cryptography) : remplacer une clé arbitrairement peut invalider des sessions ou rendre des identifiants stockés illisibles.

Définis `TALE_AUDIT_PEPPER` pour pseudonymiser les données des connexions échouées. La conservation d’audit s’applique par organisation. Vérifie sa politique effective et la période de preuve requise dans [Conservation](/fr/self-hosted/configuration/retention).

## Éprouver la restauration

Choisis la fréquence des sauvegardes et leur conservation selon la perte de données acceptable pour ton organisation. Inclus base, configuration, stockage objet et secrets nécessaires à la restauration. Les stockages externes nécessitent une sauvegarde coordonnée distincte.

Garde des copies protégées hors de l’hôte du déploiement et restaure-les régulièrement vers une destination isolée. Vérifie ensuite connexion, fichiers et parcours essentiels. [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) précise la portée des snapshots CLI et les interruptions de service.

## Limiter les destinations de la sandbox

Le proxy de sortie de la sandbox autorise par défaut les destinations HTTPS publiques tout en bloquant les adresses privées et les adresses de métadonnées. `SANDBOX_EGRESS_ALLOWLIST` permet de restreindre aussi les noms d’hôtes. Cet exemple va dans le fichier `.env` du projet et autorise deux hôtes de paquets Python :

```dotenv .env
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$
```

Recrée le service de sortie avec l’environnement modifié. Vérifie qu’une destination nécessaire fonctionne et qu’une destination absente de la liste est refusée. Ajoute d’autres registres ou hôtes source seulement si tes traitements en ont besoin. Les appels aux modèles passent par la passerelle dédiée de la sandbox ; cette liste ne régit donc pas toutes les connexions sortantes de Tale.

## Surveiller et enquêter

Configure l’accès authentifié aux métriques avec `METRICS_BEARER_TOKEN` et connecte ton système de surveillance. Vérifie qu’une alerte atteint l’opérateur responsable. [Exploitation](/fr/self-hosted/operate/observability/operations) décrit les signaux utiles.

Une tâche quotidienne vérifie progressivement les lignes d’audit conservées et signale aux admins les ruptures de hachage détectées. **Vérifier maintenant**, dans **Paramètres > Gouvernance > Journaux > Intégrité de la chaîne**, contrôle au plus 1 000 entrées. Consulte [Intégrité du journal d’audit](/fr/self-hosted/operate/security/audit-log-integrity) pour les limites et la conservation des preuves.

## Vérifier la réponse du déploiement

Inspecte les en-têtes de sécurité à l’adresse publique après une modification du proxy. Celui-ci peut changer les en-têtes produits par Tale ; la configuration source ne suffit donc pas. Examine la politique de sécurité du contenu, les restrictions d’intégration dans une page, les règles HTTPS et le traitement des types de contenu, puis teste la connexion réelle.

Ne copie pas des réglages d’isolation entre origines ou de préchargement HSTS d’un autre déploiement sans examiner tes retours d’authentification, ressources externes et sous-domaines. Conserve les résultats avec le compte rendu de déploiement et répète les contrôles après les mises à jour.

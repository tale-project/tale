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

Le fichier `robots.txt` de la plateforme déconseille l’indexation de l’application, mais autorise explicitement les chemins publics destinés aux intégrateurs et au suivi d’état, dont `/docs`, `/openapi.json`, `/llms.txt`, `/llms-full.txt` et `/status`. Ces consignes aux robots ne sont pas des contrôles d’accès. Protège les données confidentielles par authentification et examine les informations exposées dans le rapport public.

## Décider si les agents de code peuvent se connecter {#agent-sign-in}

La [connexion des agents de code](/fr/self-hosted/configuration/authentication#coding-agent-sign-in) permet à une personne de connecter Claude Code, Codex, Cursor ou un autre agent au point d’accès MCP sans clé API, et elle est activée tant que tu ne la désactives pas. Elle ajoute des surfaces publiques : les documents de découverte sous `/.well-known/oauth-*`, les points d’accès `/api/auth/oauth2/*` du serveur de connexion (dont l’auto-enregistrement, limité en débit) et la page où la personne autorise l’accès, `/oauth/consent`. Une connexion ne fait jamais plus que ce que le rôle de sa personne permet, appartient à une organisation et à l’accès que la personne a choisi, et chaque connexion, modification et déconnexion figure dans le journal d’audit. Le retrait de la personne, un nouveau mot de passe ou un jeton de rafraîchissement utilisé deux fois la déconnectent.

Si tu la laisses activée, vérifie trois points :

- **Accessibilité.** Les agents qui tournent sur l’ordinateur d’une personne (Claude Code, Codex, Cursor, VS Code, Gemini CLI) joignent Tale par le navigateur de cette personne et une redirection en boucle locale : ils n’exigent aucune ouverture au-delà de l’adresse publique que les personnes ouvrent déjà. claude.ai, Claude Desktop et l’application mobile se connectent en revanche depuis le cloud d’Anthropic. Pour eux, autorise le HTTPS entrant depuis la plage sortante publiée par Anthropic (actuellement `160.79.104.0/21`, voir [adresses IP d’Anthropic](https://platform.claude.com/docs/en/api/ip-addresses)) vers `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*`, `/api/auth/.well-known/openid-configuration`, `/api/auth/oauth2/token`, `/api/auth/oauth2/register` et `/api/v1/mcp`. Un déploiement accessible uniquement sur un réseau privé ne peut pas être utilisé depuis ces applications hébergées.
- **Trafic sortant.** Le backend récupère le document de métadonnées client d’un agent sur l’hôte de l’agent : `claude.ai` pour Claude Code, `chatgpt.com` pour Codex. Si tu restreins le trafic sortant du backend, autorise ces hôtes, ou indique les hôtes que tu acceptes dans `TALE_MCP_CLIENT_METADATA_HOSTS`. Si le backend ne parvient pas à récupérer le document, l’agent apprend seulement que la récupération a échoué. Le journal du backend en donne la raison, sur une ligne qui commence par `[agent-oauth] client metadata document fetch failed`, par exemple un résolveur DNS qui répond avec une adresse privée pour l’hôte de l’agent, que Tale refuse.
- **Qui peut connecter.** Les propriétaires, admins et développeurs, ainsi que les membres qui détiennent une compétence utilisée avec une clé API. La personne doit avoir une adresse vérifiée et, là où elle est imposée, avoir terminé l’inscription à l’authentification à double facteur ; autoriser plus que la lecture exige une connexion de moins d’un jour. Passe en revue qui détient ces rôles et ces compétences, comme pour les clés API.

Pour garder les agents sur des clés API, définis `TALE_MCP_CLIENT_METADATA_DOCUMENTS=false` et `TALE_MCP_DYNAMIC_CLIENT_REGISTRATION=false`, puis recrée le backend.

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

Recrée le service de sortie avec l’environnement modifié. Vérifie qu’une destination nécessaire fonctionne et qu’une destination absente de la liste est refusée. Ajoute d’autres registres ou hôtes source seulement si tes traitements en ont besoin. Les skills de documents intégrés n’en ont pas besoin pour créer et lire des fichiers Word, PowerPoint, Excel et PDF : leurs bibliothèques sont incluses dans l’image de la sandbox. La reconnaissance de texte (OCR) des PDF numérisés n’est pas incluse. Les appels aux modèles passent par la passerelle dédiée de la sandbox ; cette liste ne régit donc pas toutes les connexions sortantes de Tale.

`SANDBOX_EGRESS_DENIED_HOSTS` fonctionne à l’inverse : elle laisse la sortie ouverte et refuse les hôtes qu’elle énumère, des noms d’hôte séparés par des virgules qui couvrent aussi leurs sous-domaines. Une sandbox qui installe par des caches de paquets que tu exploites (`SANDBOX_INCUS_NPM_REGISTRY` et `SANDBOX_INCUS_PYPI_INDEX` du backend Incus, dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference)) y énumère les registres publics, afin qu’un gestionnaire de paquets qui ignore sa configuration échoue visiblement. Ne la définis pas avec `SANDBOX_EGRESS_ALLOWLIST` : le proxy refuse alors de démarrer.

Examine séparément les autorisations de réseau privé. `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` admet les destinations des fournisseurs de modèles, y compris dans la passerelle sandbox ; il n’ouvre pas l’accès réseau général de la sandbox. `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` admet les cibles intranet et les valeurs d’URL d’image privées des produits. Active uniquement l’accès nécessaire et garde sa configuration sous contrôle opérateur. [Fournisseurs](/fr/self-hosted/configuration/providers) décrit les vérifications des modèles ; la [référence d’environnement](/fr/self-hosted/configuration/environment-reference) distingue les deux variables.

## Surveiller et enquêter

Configure l’accès authentifié aux métriques avec `METRICS_BEARER_TOKEN` et connecte ton système de surveillance. Vérifie qu’une alerte atteint l’opérateur responsable. [Exploitation](/fr/self-hosted/operate/observability/operations) décrit les signaux utiles.

Une tâche quotidienne vérifie progressivement les lignes d’audit conservées et signale aux admins les ruptures de hachage détectées. **Vérifier maintenant**, dans **Paramètres > Gouvernance > Journaux > Intégrité de la chaîne**, contrôle au plus 1 000 entrées. Consulte [Intégrité du journal d’audit](/fr/self-hosted/operate/security/audit-log-integrity) pour les limites et la conservation des preuves.

## Vérifier la réponse du déploiement

Inspecte les en-têtes de sécurité à l’adresse publique après une modification du proxy. Celui-ci peut changer les en-têtes produits par Tale ; la configuration source ne suffit donc pas. Examine la politique de sécurité du contenu, les restrictions d’intégration dans une page, les règles HTTPS et le traitement des types de contenu, puis teste la connexion réelle.

Ne copie pas des réglages d’isolation entre origines ou de préchargement HSTS d’un autre déploiement sans examiner tes retours d’authentification, ressources externes et sous-domaines. Conserve les résultats avec le compte rendu de déploiement et répète les contrôles après les mises à jour.

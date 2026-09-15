---
title: TLS et domaines
description: Choisis la gestion des certificats, configure les origines publiques et vérifie les accès après un changement de domaine.
---

Choisis l’URL que les utilisateurs ouvriront et le service qui terminera TLS avant de configurer la connexion ou d’envoyer des invitations. Le proxy Caddy de Tale peut utiliser son autorité de certification interne, obtenir des certificats publics ou servir HTTP derrière ton propre proxy TLS.

## Choisir un mode TLS

| `TLS_MODE` | Cas d’usage | Ce que tu exploites |
| --- | --- | --- |
| `selfsigned` | Développement local ou environnement privé dont les clients font confiance à ta CA. | Installer le certificat racine Caddy dans le magasin de confiance de chaque client. |
| `letsencrypt` | Nom d’hôte public servi par le proxy Tale. | DNS public, ports 80/443 accessibles et stockage persistant des certificats Caddy. |
| `external` | Load balancer ou reverse proxy qui termine déjà TLS. | Certificat amont, transfert de confiance et liaison HTTP privée vers Tale. |

Garde `SITE_URL` comme URL publique et `HOST` comme nom d’hôte. Pour appliquer de nouvelles valeurs d’environnement, recrée les services concernés. Avec la CLI du workspace, utilise le déploiement et ajoute `--stop` si le proxy doit être recréé ; examine l’aperçu et prévois une interruption. Dans ton propre Compose, le service s’appelle `proxy`, pas comme le conteneur généré.

## Faire confiance à un certificat de développement privé

`TLS_MODE=selfsigned` fait émettre les certificats par la CA interne de Caddy. Un avertissement du navigateur peut indiquer que le client ne fait pas confiance à cette CA ou que le nom d’hôte ne correspond pas. Vérifie les deux.

Copie le **certificat racine public** depuis le conteneur proxy actif. Affecte à `TALE_PROXY_CONTAINER` le véritable nom de ce conteneur :

```bash
docker cp "$TALE_PROXY_CONTAINER:/data/caddy/pki/authorities/local/root.crt" ./tale-local-root.crt
```

Vérifie qu’il provient de ton instance, puis installe-le dans les paramètres de certificats de confiance du système ou du navigateur de chaque client concerné. Ne distribue pas la clé privée de la CA. Exécuter `caddy trust` avec `docker exec` modifie le magasin du conteneur, pas celui de ton poste. Le [guide HTTPS local de Caddy](https://caddyserver.com/docs/automatic-https#local-https) précise cette limite.

## Obtenir un certificat public

1. Fais pointer les enregistrements DNS publics du nom d’hôte vers le serveur prévu. Vérifie A et AAAA si IPv6 est configuré.
2. Rends les ports 80 et 443 accessibles sur ce proxy et conserve son volume `caddy-data` lors des remplacements.
3. Configure l’URL publique et le mode de certificat :

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=letsencrypt
TLS_EMAIL=ops@example.com
```

4. Applique la configuration, consulte `tale logs proxy`, puis ouvre l’URL publique depuis une autre machine. Vérifie le nom d’hôte et la chaîne du certificat dans le navigateur.

Caddy gère émission et renouvellement. Des problèmes DNS, réseau, ACME ou de stockage peuvent les retarder ou les empêcher. Surveille donc l’expiration et les erreurs du proxy sans supposer un délai fixe. `TLS_EMAIL` est l’adresse de contact ACME ; elle ne remplace pas la surveillance des échéances. Les [prérequis HTTPS de Caddy](https://caddyserver.com/docs/automatic-https) décrivent les conditions réseau publiques.

## Utiliser un proxy TLS amont ou ton certificat

Définis `TLS_MODE=external` lorsqu’un autre proxy termine TLS, tout en gardant l’URL HTTPS publique :

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=external
TRUSTED_PROXIES=10.20.0.0/16
```

Dans ce montage, Caddy sert HTTP en interne ; ton proxy doit donc lui indiquer comment le navigateur s’est connecté. Transmets l’en-tête `Host` d’origine et envoie `X-Forwarded-Proto: https` : Tale s’appuie sur les deux pour garder chaque navigateur sur l’origine qu’il a ouverte. Caddy n’accepte les en-têtes transférés que depuis les adresses listées dans `TRUSTED_PROXIES` : des plages CIDR séparées par des espaces, ou `private_ranges` pour toutes les adresses privées et de bouclage, valeur par défaut si la variable n’est pas définie. Indique la plage depuis laquelle ton proxy se connecte. Toute autre valeur empêche le proxy de démarrer ; les autres modes TLS ignorent cette variable.

Garde cette liaison HTTP privée. Le conteneur proxy publie le port 80 : n’en autorise l’accès qu’à ton proxy TLS, sinon un client situé dans une plage de confiance pourrait se prévaloir d’une connexion HTTPS qu’il n’a jamais établie. Vérifie les retours de connexion, cookies sécurisés, imports et flux sur le chemin complet. Un certificat installé sur le proxy amont est indépendant du mode TLS de Tale.

Si tu maintiens plutôt une image de proxy Tale et un Caddyfile personnalisés, monte certificat et clé privée en lecture seule, puis configure la directive Caddy `tls <cert-file> <key-file>`. Monter les fichiers ou définir `TLS_MODE=external` ne les charge pas automatiquement. Ta configuration doit conserver les routes Tale, les sondes et la protection des métriques.

## Changer le domaine public ou le chemin de base

Modifie `HOST` et `SITE_URL` ensemble, ainsi que les points d’accès de stockage publics et les callbacks du fournisseur d’identité qui utilisent l’ancienne origine. Recrée les services applicatifs et proxy concernés. Teste ensuite la connexion, le téléchargement d’un fichier existant, un import et une page actualisée en direct sur la nouvelle URL.

Pour un déploiement géré créé avec `identity.bootstrap: "fresh"`, suis aussi la [procédure de migration du nom d’hôte](/fr/self-hosted/install/cli-install#managed-origin-migration). Elle exige l’état conservé du déploiement et un `identity.migrateOriginFrom` explicite. Modifier uniquement `HOST` et `SITE_URL` ne met pas à jour les journaux de l’identité et des clients gérés. Conserve le compte, l’organisation et les identifiants client, puis exporte la configuration des applications clientes pour le nouvel émetteur une fois le déploiement prêt.

Pour un sous-chemin comme `https://example.com/app`, définis aussi `BASE_PATH=/app`. Garde ce préfixe dans les requêtes envoyées au proxy Tale : ses routes générées le retirent en interne. Vérifie les liens absolus et callbacks, pas seulement l’accueil. Lors d’une transition planifiée, conserve l’ancien domaine tant que les utilisateurs ont besoin de ses liens ou sessions.

## Servir plusieurs domaines {#plusieurs-domaines-a-la-fois}

Liste les origines supplémentaires dans `ADDITIONAL_SITE_URLS`, séparées par des virgules ou des espaces :

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
ADDITIONAL_SITE_URLS=https://tale.partner.example,https://app.example.org
```

Une origine comprend un schéma, un hôte et éventuellement un port, sans chemin. Caddy sert les origines listées et demande leurs certificats publics en mode `letsencrypt`. Configure le DNS et l’accès pour chacune. Ce sont des points d’entrée distincts ; les cookies restent liés au domaine sur lequel l’utilisateur se connecte.

Tale n’accepte que les origines configurées pour construire les URL publiques. Un hôte inconnu retombe sur `SITE_URL`. N’utilise pas ce repli à la place d’une configuration de domaine.

### Garder les paramètres canoniques stables

| Paramètre | Pourquoi le domaine principal compte |
| --- | --- |
| Liens par e-mail et notifications | Le travail en arrière-plan n’a pas d’origine de navigateur. |
| Entity ID du SP SAML | Le fournisseur d’identité connaît un identifiant stable du service. |
| Adresses des ressources SCIM | La synchronisation d’annuaire a besoin d’URL stables. |
| Passkeys | Les identifiants sont liés au domaine de la partie de confiance et ne passent pas automatiquement d’un domaine à l’autre. |
| Point d’accès public du stockage objet | Les tâches en arrière-plan signent les liens de fichiers pour ce point d’accès. Un lien remis au navigateur utilise le domaine sur lequel il se trouve lorsque ce point d’accès est l’une des origines du déploiement ; revois un hôte de fichiers distinct lors d’un changement de domaine. |

### Enregistrer chaque callback fournisseur

Ouvre **Paramètres > SSO d'entreprise** pour copier l’URL de redirection OIDC ou ACS SAML de chaque domaine. Les métadonnées SAML contiennent les entrées ACS configurées. Pour le consentement des connecteurs, utilise les URL par domaine sous **Paramètres > Connectors > Apps OAuth**. Enregistre les URL nécessaires chez chaque fournisseur et teste une nouvelle connexion depuis chaque origine prise en charge.

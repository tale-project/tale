---
title: Authentification
description: Les quatre modes de sign-in que Tale ship — mot de passe local, Microsoft Entra, OIDC générique et trusted headers — et comment un opérateur bascule entre eux.
---

Tale ship quatre modes de sign-in qu'un opérateur choisit par instance. Le défaut est mot de passe local, avec un utilisateur par e-mail ; Microsoft Entra et OIDC générique délèguent l'identité à un fournisseur externe ; trusted headers remet la responsabilité à un reverse proxy qui termine déjà SSO en amont. La décision est permanente au sens où elle façonne comment les utilisateurs sont provisionnés — changer de mode après le rollout est possible, mais chaque utilisateur existant doit être re-mappé sur la nouvelle source d'identité.

Mot de passe local et trusted headers se basculent par variables d'env ([Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference)) ; Microsoft Entra et OIDC générique se configurent par organisation dans l'app en marche. Cette page est le walkthrough mode par mode — quand choisir chacun, ce qu'il change pour l'utilisateur, ce qui casse quand il est mal configuré.

## Mot de passe local (défaut)

Mot de passe local est le mode que tu obtiens si tu ne règles rien. La plateforme stocke un hash bcrypt dans Postgres, signe la session avec `BETTER_AUTH_SECRET`, et l'utilisateur se connecte avec un e-mail et un mot de passe que l'admin lui a fourni dans l'invitation. Aucun fournisseur d'identité externe n'est impliqué.

Choisis-le sur les petites instances et les déploiements auto-hébergés air-gapped où ajouter un IdP crée plus de friction qu'il n'en résout. Le coût : la réinitialisation de mot de passe passe par l'admin (ou par e-mail si `SMTP_*` est configuré), et il n'y a pas d'histoire SSO.

```bash
# .env — pas de flag nécessaire pour le mot de passe local
HOST=localhost
SITE_URL=https://localhost
BETTER_AUTH_SECRET=...
```

## Microsoft Entra

Le mode Microsoft Entra ajoute un bouton **Continuer avec SSO** à l'écran de sign-in et accepte les utilisateurs d'un tenant que tu contrôles. Il n'y a pas d'interrupteur par variable d'env : la connexion se configure par organisation sous **Paramètres > SSO d'entreprise** une fois la plateforme démarrée — choisis le protocole **Microsoft Entra ID** et renseigne le client ID, le client secret et l'URL d'issuer de ton enregistrement d'application. Le walkthrough complet, y compris le mapping des rôles et la synchronisation groupes-vers-équipes, est [SSO d'entreprise et provisionnement](/fr/platform/admin/enterprise-sso).

Deux valeurs de déploiement doivent être justes avant que le flow fonctionne : `SITE_URL`, car l'URL de redirection de sign-in en est dérivée, et `BETTER_AUTH_SECRET`, qui signe le state OAuth. L'URI de redirection à enregistrer dans Entra est `${SITE_URL}${BASE_PATH}/http_api/api/sso/callback` — la page de paramètres affiche l'URL exacte à copier, et elle doit correspondre octet pour octet, sinon Entra rejette le sign-in avec `AADSTS50011`. L'ID du tenant dans l'enregistrement d'application Entra restreint qui peut se connecter ; un enregistrement multi-tenant accepte quiconque a un compte Microsoft, ce qui est rarement ce que tu veux.

## OIDC générique

L'OIDC générique accepte tout fournisseur d'identité conforme à la spec — Keycloak, Authentik, Okta, Google Workspace. La configuration vit sur la carte **Authentification unique** sous **Paramètres > Connectors** : choisis le type de fournisseur **OIDC générique**, saisis l'URL de l'émetteur, le client ID et le client secret, et Tale lit les points de terminaison d'autorisation, de jeton et userinfo depuis le document `.well-known/openid-configuration` de l'émetteur. Le flow utilise le grant Authorization Code standard avec PKCE (S256). Tale ne stocke aucun secret sur disque pour OIDC ; le client ID et le client secret vivent dans le credential store chiffré. L'URI de redirection à enregistrer chez ton fournisseur est `${SITE_URL}/http_api/api/sso/callback`.

Les fournisseurs d'identité ne s'accordent pas sur l'emplacement des claims, donc la carte te laisse pointer Tale vers les tiens. Les champs **Claim d'e-mail**, **Claim de nom** et **Claim de groupes** prennent un nom de claim ou un chemin en notation pointée dans la réponse userinfo — les rôles de realm de Keycloak, par exemple, vivent sous `realm_access.roles`. Les règles de correspondance des rôles attribuent les rôles de la plateforme au sign-in : une règle **Groupe** compare les groupes de l'utilisateur à un motif avec caractère générique (`platform-admin*` → Admin), une règle **Claim** compare n'importe quel claim résolu par chemin pointé. **Provisionnement automatique des équipes** reflète les groupes renvoyés par ton fournisseur comme équipes Tale à chaque sign-in, moins les groupes que tu exclus.

Un exemple Keycloak complet : crée un client confidentiel `tale-platform` avec l'URI de redirection ci-dessus, ajoute un mapper Group Membership pour que le client émette `groups` dans userinfo, puis dans Tale règle l'émetteur sur `https://keycloak.example.com/realms/<realm>`, ajoute une règle de groupe `platform-admin*` → Admin et clique sur **Tester la connexion** — la discovery est validée avant que quoi que ce soit ne soit enregistré.

C'est le mode pour les équipes qui font déjà tourner un IdP et veulent leur surface d'identité existante dans Tale.

## Trusted headers

Trusted headers est le mode pour les sites qui terminent SSO sur un reverse proxy en amont — oauth2-proxy, Pomerium, Authelia. Le proxy authentifie l'utilisateur et transmet des en-têtes d'identité ; Tale lit par défaut `Remote-Email`, `Remote-Name`, `Remote-Role` et `Remote-Teams`, leur fait confiance et crée ou met à jour l'enregistrement utilisateur à la volée. Si ton proxy nomme ses en-têtes autrement (oauth2-proxy envoie `X-Auth-Request-Email`), fais correspondre les noms avec les variables `TRUSTED_*_HEADER` de la [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference).

```bash
# .env
TRUSTED_HEADERS_ENABLED=true
TRUSTED_HEADERS_INTERNAL_SECRET=<longue valeur aléatoire>
```

Le secret n'est pas optionnel : n'importe qui capable de joindre le backend peut forger les en-têtes d'identité, donc l'endpoint refuse de fonctionner tant que `TRUSTED_HEADERS_INTERNAL_SECRET` n'est pas défini. Configure le proxy authentifiant pour qu'il envoie la même valeur dans l'en-tête `Remote-Internal-Secret` sur chaque requête transmise à Tale (renomme l'en-tête via `TRUSTED_SECRET_HEADER` si ton proxy impose ses propres noms) — une requête qui arrive sans la valeur attendue est refusée avant toute recherche d'utilisateur.

`Remote-Teams` porte les appartenances aux équipes sous forme d'entrées `id:name` séparées par des virgules — `t-fin:Finance, t-ops:Operations`. À chaque connexion, Tale crée dans l'organisation chaque équipe nommée qui n'existe pas encore et y ajoute l'utilisateur ; une équipe que l'en-tête ne nomme plus, il la quitte. La synchronisation ne touche qu'aux appartenances qu'elle a elle-même accordées — celle qu'un admin a attribuée à la main reste. Omets l'en-tête pour que Tale ne gère pas les équipes ; envoie-le présent mais vide pour révoquer toutes les appartenances accordées par le proxy. Une valeur présente sans aucune entrée `id:name` (des noms seuls, par exemple) compte comme vide et laisse un avertissement dans les logs du conteneur plateforme — regarde-les si des utilisateurs perdent leurs équipes après un changement de proxy.

Le modèle de menace reste délicat. Tout ce qui peut joindre le conteneur plateforme avec ces en-têtes **et** le secret devient l'utilisateur qu'ils nomment. Restreins le port plateforme pour que seul le proxy puisse lui parler (un réseau Docker ou une règle firewall hôte), et n'expose jamais le conteneur plateforme directement à Internet quand ce mode est actif.

## Où cela s'inscrit

Les quatre modes sont mutuellement exclusifs en esprit mais techniquement additifs — Microsoft Entra et trusted headers peuvent coexister sur la même instance si ton histoire IdP est en pleine migration. La table complète des compromis par mode vit dans [Membres et rôles](/fr/platform/admin/members-and-roles) côté utilisateur ; cette page couvre le commutateur de l'opérateur. La prochaine page de configuration qui vaut la lecture est [Fournisseurs](/fr/self-hosted/configuration/providers) — une fois que les utilisateurs peuvent se connecter, il faut toujours au moins un fournisseur de modèle câblé avant qu'ils ne puissent faire quoi que ce soit.

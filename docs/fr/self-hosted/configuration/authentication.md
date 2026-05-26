---
title: Authentification
description: Les quatre modes de sign-in que Tale ship — mot de passe local, Microsoft Entra, OIDC générique et trusted headers — et quelles variables d'env basculent entre eux.
---

Tale ship quatre modes de sign-in qu'un opérateur choisit par instance. Le défaut est mot de passe local, avec un utilisateur par e-mail ; Microsoft Entra et OIDC générique délèguent l'identité à un fournisseur externe ; trusted headers remet la responsabilité à un reverse proxy qui termine déjà SSO en amont. La décision est permanente au sens où elle façonne comment les utilisateurs sont provisionnés — changer de mode après le rollout est possible, mais chaque utilisateur existant doit être re-mappé sur la nouvelle source d'identité.

Les variables d'env qui activent chaque mode vivent dans [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference). Cette page est le walkthrough mode par mode — quand choisir chacun, ce qu'il change pour l'utilisateur, ce qui casse quand il est mal configuré.

## Mot de passe local (défaut)

Mot de passe local est le mode que tu obtiens si tu ne règles rien. La plateforme stocke un hash bcrypt dans Postgres, signe la session avec `BETTER_AUTH_SECRET`, et l'utilisateur se connecte avec un e-mail et un mot de passe que l'admin lui a fourni dans l'invitation. Aucun fournisseur d'identité externe n'est impliqué.

Choisis-le sur les petites instances et les déploiements auto-hébergés air-gapped où ajouter un IdP crée plus de friction qu'il n'en résout. Le coût : la réinitialisation de mot de passe passe par l'admin (ou par e-mail si `SMTP_*` est configuré), et il n'y a pas d'histoire SSO.

```bash
# .env — pas de flag nécessaire pour le mot de passe local
HOST=tale.local
SITE_URL=https://tale.local
BETTER_AUTH_SECRET=...
```

## Microsoft Entra

Le mode Microsoft Entra ajoute un bouton OAuth/OIDC à l'écran de sign-in et accepte les utilisateurs d'un tenant que tu contrôles. Mets `MICROSOFT_AUTH_ENABLED=true` pour activer le bouton ; le client ID, le client secret et l'URI de redirection par tenant se configurent dans **Paramètres > Authentification** une fois la plateforme démarrée.

```bash
# .env
MICROSOFT_AUTH_ENABLED=true
```

L'URI de redirection dont Entra a besoin est `${SITE_URL}/api/auth/callback/microsoft`. L'ID du tenant dans l'enregistrement d'application Entra restreint qui peut se connecter ; un enregistrement multi-tenant accepte quiconque a un compte Microsoft, ce qui est rarement ce que tu veux.

## OIDC générique

L'OIDC générique accepte tout fournisseur d'identité conforme à la spec — Keycloak, Authentik, Okta, Google Workspace. Le libellé du bouton se configure dans **Paramètres > Authentification**, et le flow utilise le grant Authorization Code standard avec PKCE. Tale ne stocke aucun secret sur disque pour OIDC ; le client ID et l'URL de discovery passent par l'UI, le client secret par le credential store chiffré.

C'est le mode pour les équipes qui font déjà tourner un IdP et veulent leur surface d'identité existante dans Tale.

## Trusted headers

Trusted headers est le mode pour les sites qui terminent SSO sur un reverse proxy en amont — oauth2-proxy, Pomerium, Authelia. Le proxy authentifie l'utilisateur et transmet les en-têtes d'identification (`X-Auth-Request-Email`, `X-Auth-Request-Preferred-Username`) ; Tale fait confiance à ces en-têtes et crée ou met à jour l'enregistrement utilisateur à la volée.

```bash
# .env
TRUSTED_HEADERS_ENABLED=true
```

Le modèle de menace est délicat. Tout ce qui peut joindre le conteneur plateforme avec ces en-têtes devient l'utilisateur qu'ils nomment. Restreins le port plateforme pour que seul le proxy puisse lui parler (un réseau Docker ou une règle firewall hôte), et n'expose jamais le conteneur plateforme directement à Internet quand ce mode est actif.

## Où cela s'inscrit

Les quatre modes sont mutuellement exclusifs en esprit mais techniquement additifs — Microsoft Entra et trusted headers peuvent coexister sur la même instance si ton histoire IdP est en pleine migration. La table complète des compromis par mode vit dans [Membres et rôles](/fr/platform/admin/members-and-roles) côté utilisateur ; cette page couvre le commutateur de l'opérateur. La prochaine page de configuration qui vaut la lecture est [Fournisseurs](/fr/self-hosted/configuration/providers) — une fois que les utilisateurs peuvent se connecter, il faut toujours au moins un fournisseur de modèle câblé avant qu'ils ne puissent faire quoi que ce soit.

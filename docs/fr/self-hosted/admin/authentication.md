---
title: Authentification
description: Comment fonctionne l’authentification dans Tale — mot de passe, SSO Microsoft Entra ID et Trusted Headers.
---

Tale est une plateforme offline-first. Pas d’inscription self-service ni de reset de mot de passe. Le premier utilisateur qui ouvre l’application crée le compte Owner. Tous les suivants sont créés par un admin dans **Paramètres > Membres**.

Pour activer la connexion self-service et le provisioning automatique des comptes, connecte Tale à un fournisseur SSO ou configure des Trusted Headers.

## Mot de passe (par défaut)

Aucune configuration requise. Les admins créent les utilisateurs avec e-mail, mot de passe et rôle dans **Paramètres > Membres**. Les utilisateurs se connectent avec leurs credentials sur la page de login.

Les utilisateurs venus par SSO ou Trusted Headers peuvent aussi définir un mot de passe depuis **Paramètres du compte** pour activer la connexion directe.

## Microsoft Entra ID (SSO)

Single sign-on avec Microsoft 365 / Azure AD. Les utilisateurs se connectent avec leur compte Microsoft existant et sont provisionnés automatiquement à la première connexion.

### Installation Azure

1. Dans le [Portail Azure](https://portal.azure.com) → Microsoft Entra ID → App registrations.
2. Crée une nouvelle registration (ou utilise une existante).
3. Ajoute une redirect URI : `https://yourdomain.com/api/sso/callback`.
4. Note Application (client) ID, Directory (tenant) ID et crée un client secret.

### Installation Tale

1. Va dans **Paramètres > Intégrations** dans le panneau d’admin Tale.
2. Choisis **Microsoft Entra ID** comme fournisseur SSO.
3. Entre client ID, client secret et issuer URL.
4. Optionnellement active group sync, role mapping, auto-provisioning et OneDrive access.

Le bouton SSO apparaît sur la page de login une fois configuré.

> **Note :** SSO et mot de passe peuvent coexister. Les utilisateurs qui existaient avant l’activation du SSO gardent leur mot de passe.

## Trusted Headers

Pour les déploiements derrière un reverse proxy authentifiant comme Authelia, Authentik ou oauth2-proxy. Le proxy authentifie les utilisateurs en externe ; Tale lit l’identité depuis les headers HTTP et provisionne les comptes automatiquement à la première requête.

Quand les Trusted Headers sont actifs, la page de login est contournée — les utilisateurs sont authentifiés de façon transparente à chaque requête.

### Configuration

Ajoute cette variable à ton `.env` :

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

### Noms des headers

Par défaut, Tale lit ces headers :

| Header      | Requis | Nom par défaut | Description                                                                               |
| ----------- | ------ | -------------- | ----------------------------------------------------------------------------------------- |
| E-mail      | Oui    | `Remote-Email` | adresse e-mail de l’utilisateur.                                                          |
| Nom affiché | Non    | `Remote-Name`  | nom affiché (retombe sur la partie avant `@`).                                            |
| Rôle        | Non    | `Remote-Role`  | `admin`, `developer`, `editor` ou `member` (défaut : `member`).                           |
| Équipes     | Non    | `Remote-Teams` | liste séparée par virgules au format `id:name` (ex. `abc123:Engineering, def456:Design`). |

Chaque proxy utilise des noms différents. Surcharge les défauts avec des variables d’environnement :

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Configurations proxy courantes :

| Proxy        | Header e-mail       | Header nom         | Header groupes/rôle  |
| ------------ | ------------------- | ------------------ | -------------------- |
| Authelia     | `Remote-Email`      | `Remote-Name`      | `Remote-Groups`      |
| Authentik    | `X-authentik-email` | `X-authentik-name` | `X-authentik-groups` |
| oauth2-proxy | `X-Forwarded-Email` | `X-Forwarded-User` | `X-Forwarded-Groups` |

### Fonctionnement

1. Le reverse proxy authentifie l’utilisateur et pose les headers d’identité.
2. La page de login détecte le mode Trusted Headers et navigue le navigateur vers `/api/trusted-headers/authenticate` via `window.location.href` (navigation côté client, pas redirect HTTP).
3. Tale lit les headers, trouve ou crée l’utilisateur et pose un cookie de session.
4. Le navigateur est redirigé vers le dashboard.

Aux requêtes suivantes, le cookie de session est réutilisé. La session est rafraîchie et les valeurs des headers (rôle, équipes) mises à jour à chaque authentification.

### Équipes

L’IdP externe est la source unique de vérité pour les équipes — les IDs sont passés directement sans lookup interne. Omets le header des équipes pour ne pas changer ; envoie-le vide pour retirer l’utilisateur de toutes les équipes.

### Secret interne (optionnel)

Pour defense-in-depth, définis un secret partagé que l’endpoint Convex valide :

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

L’endpoint d’auth ne peut alors être appelé qu’à travers la chaîne de proxy de confiance.

> **Sécurité :** N’active les Trusted Headers que derrière un proxy de confiance qui supprime ces headers des requêtes externes. Si des clients externes peuvent poser les headers directement, ils peuvent se faire passer pour n’importe quel utilisateur.

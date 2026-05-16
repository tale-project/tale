---
title: Authentification
description: Fonctionnement de l'authentification dans Tale — connexion par mot de passe, SSO Microsoft Entra ID et en-têtes HTTP de confiance.
---

L'authentification décide qui entre dans une instance Tale, point final. Le produit livre trois méthodes — mot de passe, SSO Microsoft Entra ID et intégration via en-têtes HTTP de confiance avec un reverse proxy en amont — et elles peuvent tourner côte à côte sur la même instance. Cette page s'adresse à l'opérateur qui branche l'authentification sur un fournisseur d'identité ; la matrice des rôles qui décide ce que chaque utilisateur peut faire une fois entré vit sur [Membres et rôles](/fr/platform/admin/members-and-roles).

Tale est offline-first par défaut. Pas d'inscription publique, pas de réinitialisation de mot de passe par lien « mot de passe oublié », pas de création de compte automatique. Le premier utilisateur qui ouvre l'application devient Propriétaire ; tous les autres sont créés par un Admin dans **Paramètres > Membres**, ou provisionnés automatiquement par SSO ou par en-têtes de confiance.

## Mot de passe (par défaut)

Aucune configuration requise. Les Admins créent les utilisateurs avec une adresse de courriel, un mot de passe et un rôle dans **Paramètres > Membres**. Les utilisateurs se connectent avec ces identifiants sur la page de connexion standard.

Les utilisateurs arrivés via SSO ou en-têtes de confiance peuvent aussi définir un mot de passe depuis **Paramètres du compte** pour activer la connexion directe en parallèle de leur méthode principale. Les deux chemins cohabitent — un utilisateur qui a à la fois un mot de passe et un lien SSO peut utiliser l'un ou l'autre.

## SSO Microsoft Entra ID

Microsoft Entra ID est le chemin SSO pour les organisations sous Microsoft 365 ou Azure AD. Les utilisateurs se connectent avec leur compte Microsoft existant et sont provisionnés automatiquement à la première connexion. Le flux utilise OIDC en sous-marin ; Tale joue le rôle de relying party.

### Étape 1 — Enregistrer l'application dans Azure

Dans le [Portail Azure](https://portal.azure.com), ouvre **Microsoft Entra ID > App registrations** et crée un nouvel enregistrement (ou choisis-en un existant).

Ajoute une redirect URI : `https://yourdomain.com/api/sso/callback`. Note l'Application (client) ID et le Directory (tenant) ID ; les deux viennent directement du blade **Overview**. Génère un client secret sous **Certificates & secrets** et copie la valeur — Azure n'affiche le secret qu'une seule fois.

### Étape 2 — Brancher Tale sur Azure

Dans Tale, ouvre **Paramètres > Intégrations** et sélectionne **Microsoft Entra ID** comme fournisseur SSO. Colle le client ID, le tenant ID et le secret. Des bascules optionnelles activent la synchronisation des groupes, le mapping des rôles, le provisioning automatique des nouveaux comptes et l'accès OneDrive pour la base de connaissances ; active chacune d'elles si elle colle à ta configuration IdP.

Le bouton SSO apparaît sur la page de connexion une fois la configuration en place. SSO et connexion par mot de passe cohabitent — les utilisateurs qui existaient avant l'activation du SSO continuent avec leur mot de passe ; les nouveaux comptes créés via SSO peuvent ajouter un mot de passe plus tard.

Pour les installations infrastructure-as-code qui préfèrent `.env` à l'interface, les trois valeurs sont aussi disponibles en `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` et `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`. La forme variable d'environnement et la forme UI sont équivalentes ; les mélanger ne casse rien, mais choisis l'une comme source de vérité pour une instance donnée.

## En-têtes de confiance

Les en-têtes de confiance couvrent le schéma de déploiement où Tale est placé derrière un reverse proxy authentifiant — Authelia, Authentik, oauth2-proxy ou tout autre composant qui authentifie les utilisateurs et propage leur identité dans des en-têtes HTTP. Avec les en-têtes de confiance actifs, la page de connexion est entièrement contournée : chaque requête est authentifiée de manière transparente d'après les en-têtes posés par le proxy, et un compte est provisionné au premier contact.

C'est le bon chemin quand ton organisation fait déjà tourner un portail SSO devant chaque application interne et que Tale doit rentrer dans la même frontière d'authentification.

### Activer le mode

Ajoute le drapeau à `.env` :

```dotenv
TRUSTED_HEADERS_ENABLED=true
```

Le mode prend effet après `tale deploy` (production) ou `tale start` (local) — Convex lit l'environnement au démarrage du processus, donc un stack vivant ne bascule pas tant que le conteneur n'a pas redémarré.

### Noms d'en-têtes par défaut

D'origine, Tale lit quatre en-têtes. Chaque proxy utilise des noms différents ; les surcharges de la section suivante alignent Tale sur le proxy qui se trouve devant.

| En-tête     | Requis | Nom par défaut | Description                                                                                  |
| ----------- | ------ | -------------- | -------------------------------------------------------------------------------------------- |
| Courriel    | Oui    | `Remote-Email` | Adresse de courriel de l'utilisateur.                                                        |
| Nom affiché | Non    | `Remote-Name`  | Nom affiché. Retombe sur la partie locale du courriel quand absent.                          |
| Rôle        | Non    | `Remote-Role`  | Une valeur parmi `admin`, `developer`, `editor`, `member`. Défaut : `member`.                |
| Équipes     | Non    | `Remote-Teams` | Liste séparée par virgules au format `id:name` (p. ex. `abc123:Engineering, def456:Design`). |

### Surcharger les noms d'en-têtes

La plupart des proxies ne livrent pas `Remote-*`. Surcharge les valeurs par défaut pour qu'elles correspondent au proxy qui se trouve devant :

```dotenv
TRUSTED_EMAIL_HEADER=X-Forwarded-Email
TRUSTED_NAME_HEADER=X-Forwarded-User
TRUSTED_ROLE_HEADER=X-Forwarded-Role
TRUSTED_TEAMS_HEADER=X-Forwarded-Teams
```

Proxies courants :

| Proxy        | En-tête courriel    | En-tête nom        | En-tête groupes/rôle |
| ------------ | ------------------- | ------------------ | -------------------- |
| Authelia     | `Remote-Email`      | `Remote-Name`      | `Remote-Groups`      |
| Authentik    | `X-authentik-email` | `X-authentik-name` | `X-authentik-groups` |
| oauth2-proxy | `X-Forwarded-Email` | `X-Forwarded-User` | `X-Forwarded-Groups` |

### Trajet d'une requête

Quand les en-têtes de confiance sont actifs, chaque requête du navigateur suit le même chemin :

1. Le reverse proxy authentifie l'utilisateur sur son propre annuaire d'identité et pose les en-têtes d'identité sur la requête transmise.
2. La page de connexion de Tale détecte le mode en-têtes de confiance et navigue le navigateur vers `/api/trusted-headers/authenticate` via une redirection côté client (pas un HTTP 302).
3. Le backend de Tale lit les en-têtes, trouve ou crée l'utilisateur et pose un cookie de session limité à ton domaine.
4. Le navigateur est redirigé vers le tableau de bord.

Aux requêtes suivantes, le cookie de session est réutilisé. La session se rafraîchit à chaque authentification et relit le rôle et les équipes dans les en-têtes, donc un changement dans l'annuaire d'identité en amont se propage au chargement de page suivant — pas de synchronisation manuelle.

### Propagation des équipes

Le fournisseur d'identité externe est la source unique de vérité pour les équipes ; les identifiants d'équipe passent tels quels, sans consultation interne de la base. Omets l'en-tête équipes pour ne rien changer ; envoie-le vide pour retirer l'utilisateur de toutes ses équipes.

### Secret interne (optionnel)

Pour la défense en profondeur, définis un secret partagé que l'endpoint Convex vérifie avant d'honorer les en-têtes :

```dotenv
TRUSTED_HEADERS_INTERNAL_SECRET=your-random-secret
```

Ça garantit que l'endpoint d'authentification n'est joignable qu'à travers la chaîne de proxy de confiance. Sans le secret, n'importe quelle requête qui atterrit sur `/api/trusted-headers/authenticate` avec les bons en-têtes est acceptée ; avec le secret, la requête doit aussi porter la valeur de l'en-tête interne correspondante.

N'active les en-têtes de confiance que quand le proxy en amont supprime ces mêmes en-têtes des requêtes externes. Si des clients externes peuvent les poser directement, ils peuvent se faire passer pour n'importe quel utilisateur.

## Où cela s'insère

L'authentification est la version la plus stricte de la question à laquelle [Membres et rôles](/fr/platform/admin/members-and-roles) répond. Membres et rôles décide qui peut faire quoi une fois entré ; l'authentification décide qui rentre. Les trois méthodes — mot de passe, SSO Microsoft Entra, en-têtes de reverse proxy de confiance — tournent côte à côte sur la même instance, donc une organisation peut utiliser le SSO pour les employés et les en-têtes de confiance pour une surface publique derrière Authelia, avec la même matrice de rôles Tale qui s'applique aux deux.

Pour la couche second facteur qui se pose au-dessus de chacune des trois méthodes, [Authentification à double facteur](/fr/platform/admin/two-factor-authentication) est la page. Pour l'inventaire des variables d'environnement qui relient en-têtes de confiance et SSO Entra au déploiement, [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) est l'index.

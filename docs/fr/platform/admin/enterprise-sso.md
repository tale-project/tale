---
title: SSO d’entreprise et provisionnement
description: Configurer l’authentification unique (OIDC, OAuth2, SAML 2.0) et le provisionnement SCIM des utilisateurs et des groupes pour ton organisation.
---

Le SSO d’entreprise permet à tes membres de se connecter via ton fournisseur d’identité (IdP) plutôt qu’avec un mot de passe Tale, et SCIM laisse l’IdP créer, mettre à jour et désactiver automatiquement les membres et les groupes — sans invitation manuelle. Une connexion par organisation porte ensemble le protocole de connexion, la politique de provisionnement et le jeton SCIM. Tout se trouve sur une seule page : **Paramètres > SSO d'entreprise** (administrateurs uniquement).

Tale parle quatre protocoles : **OIDC**, **OAuth2** simple, **SAML 2.0** pour la connexion et **SCIM 2.0** pour le provisionnement. Tu peux activer la connexion, le provisionnement, ou les deux.

<Frame caption="Paramètres > SSO d’entreprise — le sélecteur de protocole et les champs de connexion sur une page ; l’URL de redirection à enregistrer dans l’IdP, prête à copier.">

![La page de paramètres SSO d’entreprise avec le menu Protocole réglé sur Microsoft Entra ID et un nom d’affichage assorti, puis une section connexion qui porte l’URL de redirection à enregistrer, une URL d’émetteur et un ID client repris de l’enregistrement d’application, un secret client vide et les scopes demandés.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Choisir un protocole

Ouvre **Paramètres > SSO d'entreprise**, choisis un **Protocole** et remplis uniquement les champs de ce protocole — les autres restent masqués. Un **Guide de configuration** sur la même page liste les étapes exactes et affiche les URL à coller dans ton IdP. Utilise **Tester la connexion** avant d’enregistrer pour valider la configuration, et **Enregistrer** pour activer la connexion.

- **Microsoft Entra ID** — l’OIDC de Microsoft, avec synchronisation groupe-vers-équipe via Microsoft Graph.
- **OIDC générique** — n’importe quel fournisseur OpenID Connect (Google, Okta, Auth0, Keycloak, …). Les points de terminaison sont détectés depuis l’émetteur.
- **OAuth2** — fournisseurs sans découverte OIDC ; tu configures manuellement les points de terminaison d’autorisation, de jeton et userinfo.
- **SAML 2.0** — SSO basé sur XML ; tu échanges des métadonnées avec l’IdP.

## Microsoft Entra ID

1. Connecte-toi au [centre d’administration Microsoft Entra](https://entra.microsoft.com) en tant que développeur d’applications au minimum.
2. Va dans **Entra ID > Inscriptions d'applications > Nouvelle inscription**, nomme-la et choisis **Locataire unique**.
3. Sous **URI de redirection**, sélectionne la plateforme **Web**, colle l'**URL de redirection** affichée sur la page Tale, puis clique sur **Inscrire**.
4. Sur la **Vue d'ensemble**, copie l'**ID d'application (client)** et l'**ID de répertoire (locataire)**. Ton URL d’émetteur est `https://login.microsoftonline.com/{tenant-id}/v2.0`.
5. Ouvre **Certificats et secrets > Nouveau secret client** et copie la **Valeur** du secret (pas son ID).
6. Dans Tale, choisis **Microsoft Entra ID** et saisis l’ID client, le secret client et l’URL d’émetteur.
7. Pour la synchronisation groupe-vers-équipe, ajoute l’autorisation Microsoft Graph **GroupMember.Read.All** sous **Autorisations d'API** et accorde le consentement administrateur.
8. L’import de fichiers OneDrive et SharePoint **ne fait pas** partie du SSO. Les membres l’autorisent dans **Connaissances → Documents → Depuis Microsoft 365 → Connecter Microsoft 365**, où Tale demande Graph **Files.Read** et **Sites.Read.All**. N’ajoute pas ces scopes au champ SSO **Scopes**.

## Google

Google se configure comme un fournisseur OIDC générique.

1. Dans la [console Google Cloud](https://console.cloud.google.com), ouvre **API et services > Identifiants > Créer des identifiants > ID client OAuth**.
2. Choisis le type d’application **Application Web**.
3. Sous **URI de redirection autorisés**, ajoute l'**URL de redirection** affichée sur la page Tale, puis enregistre.
4. Copie l'**ID client** et le **secret client** en haut de la page du client.
5. Dans Tale, choisis **OIDC générique**, saisis l’ID client et le secret, et définis l’URL d’émetteur sur `https://accounts.google.com`. Les points de terminaison sont détectés automatiquement.

L’OIDC standard de Google ne renvoie **pas** les appartenances aux groupes : la synchronisation groupe-vers-équipe n’est donc pas disponible avec Google seul — elle nécessite l’Admin SDK / l’API Cloud Identity avec un administrateur Workspace. La connexion et le mappage de rôle par claim fonctionnent normalement.

## OIDC générique et OAuth2

Pour tout autre fournisseur OIDC (Okta, Auth0, Keycloak), choisis **OIDC générique**, colle l'**URL d'émetteur** et l’ID/secret client — Tale lit les points de terminaison d’autorisation, de jeton et userinfo depuis le `.well-known/openid-configuration` de l’émetteur.

Si un fournisseur expose OAuth2 mais pas de document de découverte, choisis **OAuth2** et saisis manuellement les URL des points de terminaison d'**autorisation**, de **jeton** et **userinfo**. Lorsque le fournisseur utilise des noms de claims non standard, mappe **e-mail**, **nom** et **groupes** dans les champs avancés de la connexion (les chemins en points sont pris en charge, p. ex. `realm_access.roles`).

## SAML 2.0

1. Dans Tale, choisis **SAML 2.0**. La page affiche ton **URL des métadonnées SP** et ton **URL ACS (réponse)** — copie-les.
2. Dans ton IdP, crée une nouvelle application SAML 2.0. Définis son **URL ACS** et son **Entity ID / Audience** sur les valeurs SP affichées (ou importe l’URL des métadonnées SP), et le format **Name ID** sur l’adresse e-mail.
3. Sous **Importer les métadonnées de l'IdP**, colle l’URL des métadonnées de fédération de ton IdP et clique sur **Importer** — ou clique sur **Téléverser le XML** si ton IdP ne propose qu’un fichier à télécharger. Tale lit les métadonnées et remplit l’ID d’entité, l’URL de connexion et le certificat de signature dans les champs ci-dessous, sans que tu aies à les ressaisir. Les trois champs restent modifiables — vérifie les valeurs importées (ou saisis-les toi-même si ton IdP ne publie aucune métadonnée) avant d’enregistrer.
4. Mappe les attributs **e-mail**, **nom** et **groupe** dans ton IdP ; si leurs noms diffèrent des valeurs par défaut, ouvre **Avancé** et saisis les noms correspondants sous **Attribut e-mail**, **Attribut nom** et **Attribut groupes**.

Tale prend en charge le SAML initié par l’IdP (l’IdP envoie une assertion à l’URL ACS) et le SAML initié par le SP (un membre clique sur **Se connecter avec le SSO** et Tale redirige vers l’IdP). Les assertions signées sont requises (**Exiger des assertions signées**, activé par défaut). Pour recevoir des assertions chiffrées, colle un **Certificat SP (PEM)** et sa **Clé privée SP (PEM)** sous **Avancé** — le certificat est publié dans les métadonnées SP pour que ton IdP chiffre vers lui, la clé est stockée comme secret et ne s’affiche plus jamais — puis active **Exiger des assertions chiffrées** dès que l’IdP chiffre ; une connexion qui les exige refuse toute assertion qui arrive en clair, et Tale refuse d’enregistrer ce réglage sans clé pour déchiffrer.

Une connexion que Tale démarre — le SAML initié par le SP, ainsi que toute connexion OIDC ou OAuth2 — est liée au navigateur où elle commence : Tale dépose un cookie de courte durée au moment de rediriger vers ton IdP et refuse une réponse qui revient dans un autre navigateur, si bien qu’un lien de connexion intercepté ne connecte personne d’autre. Une assertion initiée par l’IdP ne répond à aucune requête de Tale et ne porte donc pas ce lien. Si un membre apprend que sa connexion ne s’est pas terminée dans le navigateur où elle a commencé, son navigateur a perdu ce cookie — le plus souvent à cause d’un réglage de confidentialité qui bloque les cookies lors des redirections entre sites ; une nouvelle connexion depuis un navigateur qui le conserve règle le problème.

## Plusieurs organisations sur un même déploiement

Un déploiement peut héberger plusieurs organisations, chacune avec sa propre connexion. Sur la page de connexion, clique sur **Continuer avec SSO**, puis choisis ton organisation dans la liste — chaque entrée affiche le **Nom affiché** de la connexion. Ce nom est visible par quiconque sur la page de connexion ; définis un nom clair par connexion dans **Paramètres > Enterprise SSO**.

## Provisionnement : rôles et équipes

Chaque protocole partage une politique de provisionnement :

- **Rôle par défaut** — le rôle attribué à un membre nouvellement provisionné (Membre par défaut).
- **Attribuer automatiquement les rôles depuis l'IdP** — lorsqu’il est activé, des règles de mappage associent un intitulé de poste, un rôle d’application, un groupe ou un claim à un rôle de la plateforme ; le rôle par défaut s’applique si rien ne correspond.
- **Synchroniser les groupes de l'IdP avec les équipes** — lorsqu’il est activé, chaque groupe IdP de l’utilisateur devient (ou rejoint) une équipe du même nom à la connexion ; **Exclure des groupes** ignore les groupes parasites (séparés par des virgules). La synchronisation ne reprend que ce qu’elle a elle-même ajouté : quand un groupe disparaît du claim de l’utilisateur, elle retire l’appartenance qu’elle avait accordée et supprime une équipe qu’elle avait créée dès que celle-ci se vide. Les équipes et appartenances créées par des admins ou via SCIM ne sont jamais touchées, et les groupes exclus restent entièrement hors de sa portée.

## Provisionnement SCIM (utilisateurs et groupes)

SCIM permet à ton IdP de transmettre les changements sans que personne ne se connecte. Dans la section **Provisionnement SCIM**, clique sur **Générer un jeton** — copie-le une seule fois (il n’est plus jamais affiché) — et colle-le, avec l'**URL de base SCIM** affichée, dans les paramètres de provisionnement de ton IdP. L’IdP s’authentifie avec le jeton comme identifiant Bearer ; Tale détermine l’organisation à partir du jeton, qui constitue donc la frontière de locataire.

Tale implémente SCIM 2.0 **Users** et **Groups** : créer, lire, lister (avec filtres `userName`/`displayName`), remplacer, modifier (patch) et supprimer. Les utilisateurs provisionnés correspondent à des membres de l’organisation, les groupes à des équipes. **La désactivation est douce** — lorsque l’IdP rend un utilisateur inactif (`active: false`), le rôle du membre passe à `disabled` (ce qui retire son accès), et une réactivation restaure son rôle précédent. Une **suppression** SCIM retire l’appartenance à l’organisation ; le compte utilisateur est conservé, et un nouveau provisionnement le rattache avec le rôle par défaut de la connexion. Le propriétaire de l’organisation ne peut jamais être déprovisionné ni désactivé via SCIM. Les membres d’un groupe doivent appartenir à l’organisation — un utilisateur d’une autre organisation est refusé. Un changement de `userName` ne s’applique que si l’adresse est libre et que le compte appartient uniquement à cette organisation ; un compte qui est aussi membre ailleurs conserve l’adresse avec laquelle il se connecte, et l’IdP reçoit un refus à la place.

## Vérification

Utilise **Tester la connexion** pour OIDC/OAuth2 afin de confirmer la découverte et les identifiants avant d’enregistrer. Pour SAML, importe les métadonnées SP dans ton IdP et effectue une connexion de test. Pour SCIM, la plupart des IdP proposent une action « test » ou « provisionner maintenant » qui crée un utilisateur d’exemple — vérifie qu’il apparaît sous **Paramètres > Membres**. Une connexion SSO de bout en bout se vérifie au mieux contre ton IdP réel dans une organisation de préproduction.

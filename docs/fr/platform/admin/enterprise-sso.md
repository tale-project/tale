---
title: SSO d'entreprise et provisionnement
description: Configurer l'authentification unique (OIDC, OAuth2, SAML 2.0) et le provisionnement SCIM des utilisateurs et des groupes pour votre organisation. Configuration pas à pas pour Microsoft Entra ID, Google, OIDC générique et SAML, ainsi que le mappage des rôles, la synchronisation groupe-vers-équipe et la désactivation. À lire pour câbler l'identité d'entreprise de l'organisation.
---

Le SSO d'entreprise permet à vos membres de se connecter via votre fournisseur d'identité (IdP) plutôt qu'avec un mot de passe Tale, et SCIM laisse l'IdP créer, mettre à jour et désactiver automatiquement les membres et les groupes — sans invitation manuelle. Une connexion par organisation porte ensemble le protocole de connexion, la politique de provisionnement et le jeton SCIM. Tout se trouve sur une seule page : **Paramètres > SSO d'entreprise** (administrateurs uniquement).

Tale parle quatre protocoles : **OIDC**, **OAuth2** simple, **SAML 2.0** pour la connexion et **SCIM 2.0** pour le provisionnement. Vous pouvez activer la connexion, le provisionnement, ou les deux.

## Choisir un protocole

Ouvrez **Paramètres > SSO d'entreprise**, choisissez un **Protocole** et remplissez uniquement les champs de ce protocole — les autres restent masqués. Un **Guide de configuration** sur la même page liste les étapes exactes et affiche les URL à coller dans votre IdP. Utilisez **Tester la connexion** avant d'enregistrer pour valider la configuration, et **Enregistrer** pour activer la connexion.

- **Microsoft Entra ID** — l'OIDC de Microsoft, avec synchronisation groupe-vers-équipe via Microsoft Graph.
- **OIDC générique** — n'importe quel fournisseur OpenID Connect (Google, Okta, Auth0, Keycloak, …). Les points de terminaison sont détectés depuis l'émetteur.
- **OAuth2** — fournisseurs sans découverte OIDC ; vous configurez manuellement les points de terminaison d'autorisation, de jeton et userinfo.
- **SAML 2.0** — SSO basé sur XML ; vous échangez des métadonnées avec l'IdP.

## Microsoft Entra ID

1. Connectez-vous au [centre d'administration Microsoft Entra](https://entra.microsoft.com) en tant que développeur d'applications au minimum.
2. Allez dans **Entra ID > Inscriptions d'applications > Nouvelle inscription**, nommez-la et choisissez **Locataire unique**.
3. Sous **URI de redirection**, sélectionnez la plateforme **Web**, collez l'**URL de redirection** affichée sur la page Tale, puis cliquez sur **Inscrire**.
4. Sur la **Vue d'ensemble**, copiez l'**ID d'application (client)** et l'**ID de répertoire (locataire)**. Votre URL d'émetteur est `https://login.microsoftonline.com/{tenant-id}/v2.0`.
5. Ouvrez **Certificats et secrets > Nouveau secret client** et copiez la **Valeur** du secret (pas son ID).
6. Dans Tale, choisissez **Microsoft Entra ID** et saisissez l'ID client, le secret client et l'URL d'émetteur.
7. Pour la synchronisation groupe-vers-équipe, ajoutez l'autorisation Microsoft Graph **GroupMember.Read.All** sous **Autorisations d'API** et accordez le consentement administrateur.

## Google

Google se configure comme un fournisseur OIDC générique.

1. Dans la [console Google Cloud](https://console.cloud.google.com), ouvrez **API et services > Identifiants > Créer des identifiants > ID client OAuth**.
2. Choisissez le type d'application **Application Web**.
3. Sous **URI de redirection autorisés**, ajoutez l'**URL de redirection** affichée sur la page Tale, puis enregistrez.
4. Copiez l'**ID client** et le **secret client** en haut de la page du client.
5. Dans Tale, choisissez **OIDC générique**, saisissez l'ID client et le secret, et définissez l'URL d'émetteur sur `https://accounts.google.com`. Les points de terminaison sont détectés automatiquement.

L'OIDC standard de Google ne renvoie **pas** les appartenances aux groupes : la synchronisation groupe-vers-équipe n'est donc pas disponible avec Google seul — elle nécessite l'Admin SDK / l'API Cloud Identity avec un administrateur Workspace. La connexion et le mappage de rôle par claim fonctionnent normalement.

## OIDC générique et OAuth2

Pour tout autre fournisseur OIDC (Okta, Auth0, Keycloak), choisissez **OIDC générique**, collez l'**URL d'émetteur** et l'ID/secret client — Tale lit les points de terminaison d'autorisation, de jeton et userinfo depuis le `.well-known/openid-configuration` de l'émetteur.

Si un fournisseur expose OAuth2 mais pas de document de découverte, choisissez **OAuth2** et saisissez manuellement les URL des points de terminaison d'**autorisation**, de **jeton** et **userinfo**. Lorsque le fournisseur utilise des noms de claims non standard, mappez **e-mail**, **nom** et **groupes** dans les champs avancés de la connexion (les chemins en points sont pris en charge, p. ex. `realm_access.roles`).

## SAML 2.0

1. Dans Tale, choisissez **SAML 2.0**. La page affiche votre **URL des métadonnées SP** et votre **URL ACS (réponse)** — copiez-les.
2. Dans votre IdP, créez une nouvelle application SAML 2.0. Définissez son **URL ACS** et son **Entity ID / Audience** sur les valeurs SP affichées (ou importez l'URL des métadonnées SP), et le format **Name ID** sur l'adresse e-mail.
3. Copiez l'**Entity ID**, l'**URL de connexion** et le **certificat de signature (PEM)** de l'IdP dans Tale, puis enregistrez.
4. Mappez les attributs **e-mail**, **nom** et **groupe** dans votre IdP ; si leurs noms diffèrent des valeurs par défaut, indiquez les noms d'attributs correspondants dans les champs avancés de Tale.

Tale prend en charge le SAML initié par l'IdP (l'IdP envoie une assertion à l'URL ACS) et le SAML initié par le SP (un membre clique sur **Se connecter avec le SSO** et Tale redirige vers l'IdP). Les assertions signées sont requises ; les assertions chiffrées sont prises en charge si vous fournissez une paire de clés SP.

## Plusieurs organisations sur un même déploiement

Un déploiement peut héberger plusieurs organisations, chacune avec sa propre connexion. L’authentification est orientée selon le champ **Domaine de messagerie** : définissez-le sur chaque connexion (par exemple `example.com`), et les membres qui saisissent leur adresse e-mail sur la page de connexion atteignent l’IdP de leur organisation. Avec une seule connexion activée, le champ est facultatif — l’authentification retombe sur cette connexion. Avec plusieurs, il n’y a pas de repli : une tentative impossible à orienter demande l’adresse e-mail de l’organisation au lieu de deviner une connexion.

Les connexions **sans** domaine de messagerie ne peuvent pas être atteintes par correspondance d’adresse ; l’écran SSO les liste donc sous leur **Nom affiché** pour une sélection manuelle. Ce nom est visible par quiconque sur la page de connexion — définissez un domaine de messagerie pour retirer une connexion de la liste.

## Provisionnement : rôles et équipes

Chaque protocole partage une politique de provisionnement :

- **Rôle par défaut** — le rôle attribué à un membre nouvellement provisionné (Membre par défaut).
- **Attribuer automatiquement les rôles depuis l'IdP** — lorsqu'il est activé, des règles de mappage associent un intitulé de poste, un rôle d'application, un groupe ou un claim à un rôle de la plateforme ; le rôle par défaut s'applique si rien ne correspond.
- **Synchroniser les groupes de l'IdP avec les équipes** — lorsqu'il est activé, chaque groupe IdP de l'utilisateur devient (ou rejoint) une équipe du même nom à la connexion ; **Exclure des groupes** ignore les groupes parasites (séparés par des virgules).

## Provisionnement SCIM (utilisateurs et groupes)

SCIM permet à votre IdP de transmettre les changements sans que personne ne se connecte. Dans la section **Provisionnement SCIM**, cliquez sur **Générer un jeton** — copiez-le une seule fois (il n'est plus jamais affiché) — et collez-le, avec l'**URL de base SCIM** affichée, dans les paramètres de provisionnement de votre IdP. L'IdP s'authentifie avec le jeton comme identifiant Bearer ; Tale détermine l'organisation à partir du jeton, qui constitue donc la frontière de locataire.

Tale implémente SCIM 2.0 **Users** et **Groups** : créer, lire, lister (avec filtres `userName`/`displayName`), remplacer, modifier (patch) et supprimer. Les utilisateurs provisionnés correspondent à des membres de l'organisation, les groupes à des équipes. **La désactivation est douce** — lorsque l'IdP rend un utilisateur inactif (`active: false`) ou envoie une suppression, le rôle du membre passe à `disabled` (ce qui retire son accès) au lieu d'une suppression définitive, de sorte qu'une réactivation restaure son rôle précédent.

## Vérification

Utilisez **Tester la connexion** pour OIDC/OAuth2 afin de confirmer la découverte et les identifiants avant d'enregistrer. Pour SAML, importez les métadonnées SP dans votre IdP et effectuez une connexion de test. Pour SCIM, la plupart des IdP proposent une action « test » ou « provisionner maintenant » qui crée un utilisateur d'exemple — vérifiez qu'il apparaît sous **Paramètres > Membres**. Une connexion SSO de bout en bout se vérifie au mieux contre votre IdP réel dans une organisation de préproduction.

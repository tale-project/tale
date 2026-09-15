---
title: SSO d’entreprise et provisionnement
description: Connecte ton fournisseur d’identité, teste la connexion et gère les rôles et équipes avec SSO ou SCIM.
---

Le SSO d’entreprise permet aux membres de se connecter via ton fournisseur d’identité (IdP). SCIM lui permet de créer, modifier et désactiver des membres sans attendre leur connexion. Une organisation possède une connexion. En tant qu’admin ou propriétaire, tu peux activer la connexion, le provisionnement ou les deux dans **Paramètres > SSO d'entreprise**.

## Avant de commencer

Il te faut l’autorisation d’enregistrer une application chez ton IdP, ses identifiants client ou métadonnées SAML, ainsi que l’adresse publique de Tale utilisée par les membres. Garde une session admin fonctionnelle ouverte pendant les tests pour corriger la configuration si la connexion échoue.

Choisis un **Nom affiché** reconnaissable. Il apparaît dans le choix d’organisation sur la page publique de connexion : évite les informations confidentielles ou purement internes.

<Frame caption="Choisis d'abord le protocole. Tale affiche les champs utiles et l'adresse de rappel à enregistrer chez ton fournisseur d'identité.">

![Paramètres SSO d’entreprise avec Microsoft Entra ID sélectionné, une URL de redirection et les champs de l’émetteur et des identifiants client.](/images/platform/settings-enterprise-sso.webp)

</Frame>

## Choisir le protocole

| Protocole | Quand l’utiliser | Informations à préparer |
| --- | --- | --- |
| **Microsoft Entra ID** | Ton organisation utilise Entra ; la synchronisation facultative des équipes passe par Microsoft Graph. | URL de l’émetteur du tenant, ID client, secret client. |
| **OIDC générique** | Ton fournisseur prend en charge la découverte OpenID Connect. | URL de l’émetteur, ID client, secret client. |
| **OAuth2** | Ton fournisseur n’a pas de document de découverte OIDC. | Identifiants client et URL d’autorisation, de jeton et userinfo. |
| **SAML 2.0** | Ton IdP utilise des assertions SAML. | Métadonnées IdP ou son identifiant d’entité, son URL de connexion et son certificat de signature. |

## Connecter un fournisseur OIDC ou OAuth2

1. Sélectionne le protocole dans Tale et ouvre le **Guide de configuration** pour trouver l’URL de rappel.
2. Enregistre une application web chez ton IdP. Copie exactement l’URL de rappel, avec son schéma, son hôte et son chemin. Enregistre aussi les URL supplémentaires affichées si les membres utilisent plusieurs domaines du déploiement.
3. Renseigne l’ID client et le secret dans Tale. Pour OIDC, saisis l’URL de l’émetteur ; Tale découvre les points de terminaison. Pour OAuth2, saisis toi-même leurs trois URL.
4. Vérifie **Scopes** et **Avancé**. Demande les claims d’identité nécessaires à tes règles de provisionnement. Associe les noms de claims non standard si besoin ; les chemins peuvent contenir des points, comme `realm_access.roles`.
5. Choisis **Tester la connexion**, corrige les erreurs, puis **Enregistrer** dans l’en-tête. Effectue ensuite un vrai test de connexion comme indiqué plus bas.

Pour Entra, utilise un émetteur propre au tenant, comme `https://login.microsoftonline.com/{tenant-id}/v2.0`, enregistre le rappel comme URI de redirection Web et copie la valeur du secret client, pas son ID. Le [guide Microsoft d’enregistrement d’application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) décrit la configuration côté fournisseur. La synchronisation groupes-équipes exige l’autorisation Microsoft Graph `GroupMember.Read.All` et le consentement admin.

Pour Google, choisis **OIDC générique** avec l’émetteur `https://accounts.google.com` ; consulte la [configuration OpenID Connect de Google](https://developers.google.com/identity/openid-connect/openid-connect). L’OIDC standard de Google ne fournit pas les appartenances aux groupes. La connexion Google seule ne permet donc pas de synchroniser les groupes avec les équipes.

<Note>
L’import de fichiers Microsoft 365 possède son propre parcours de consentement dans les connaissances. N’ajoute pas `Files.Read` ou `Sites.Read.All` aux scopes SSO pour permettre une simple connexion. Configure l’accès à l’import via les [apps OAuth des connecteurs](/fr/platform/admin/connectors).
</Note>

## Connecter un fournisseur SAML

1. Choisis **SAML 2.0**. Copie l’**URL des métadonnées SP** et l’**URL ACS (réponse)** dans l’application SAML de ton IdP. Utilise les métadonnées du fournisseur de service pour son identifiant d’entité/audience et choisis l’adresse e-mail comme format Name ID.
2. Sous **Importer les métadonnées de l'IdP**, importe l’URL des métadonnées de l’IdP ou choisis **Téléverser le XML**. Vérifie l’identifiant d’entité, l’URL de connexion et le certificat de signature remplis par l’import. Tu peux aussi les saisir manuellement.
3. Sous **Avancé**, associe l’e-mail, le nom et les groupes si l’IdP utilise d’autres noms d’attributs. Garde **Exiger des assertions signées** activé.
4. Enregistre la connexion, puis teste une connexion via l’IdP.

Si ton IdP chiffre les assertions, ajoute un **Certificat SP (PEM)** et une **Clé privée SP (PEM)** correspondants sous **Avancé**. Le certificat est publié dans les métadonnées SP ; la clé privée est conservée comme secret et ne sera plus affichée. Configure le chiffrement dans l’IdP avant d’activer **Exiger des assertions chiffrées**. Tale refuse ce réglage sans clé de déchiffrement et rejette ensuite les assertions non chiffrées.

SAML peut être lancé par l’IdP ou par Tale. Pour une connexion commencée dans Tale, termine dans le même navigateur afin que le rappel puisse vérifier le cookie créé au départ.

## Attribuer les rôles et équipes à la connexion

| Réglage | Ce qu’il contrôle |
| --- | --- |
| **Rôle par défaut** | Rôle des nouveaux membres lorsqu’aucune règle ne correspond ; Membre au départ. |
| **Attribuer automatiquement les rôles depuis l'IdP** | Associe des groupes, rôles d’application, intitulés de poste ou claims aux rôles Tale. Vérifie qui pourrait correspondre à une règle admin avant de l’activer. |
| **Synchroniser les groupes de l'IdP avec les équipes** | Crée ou rejoint les équipes selon les groupes à la connexion. |
| **Exclure des groupes** | Noms de groupes séparés par des virgules à écarter de la synchronisation. |

Quand des groupes disparaissent, la synchronisation retire les appartenances qu’elle avait ajoutées et supprime les équipes qu’elle avait créées une fois vides. Elle préserve les appartenances créées manuellement ou par SCIM et laisse les groupes exclus tels quels. La page [Équipes](/fr/platform/admin/teams) décrit la gestion manuelle.

## Provisionner les membres par SCIM

1. Dans **Provisionnement SCIM**, choisis **Générer un jeton** et copie-le immédiatement : il n’est affiché qu’une fois.
2. Renseigne ce jeton comme identifiant Bearer et l’**URL de base SCIM** affichée dans la configuration de provisionnement de ton IdP.
3. Provisionne un utilisateur et un groupe de test. Vérifie que le membre et l’équipe apparaissent dans Tale, puis teste les modifications et la désactivation avant d’élargir le déploiement.

Les Users SCIM correspondent aux membres et les Groups aux équipes. La désactivation (`active: false`) bloque l’accès du membre ; la réactivation restaure son rôle précédent. Supprimer un utilisateur SCIM retire son appartenance à l’organisation mais conserve son compte. Un nouveau provisionnement lui attribue le rôle par défaut de la connexion.

Le propriétaire de l’organisation ne peut pas être désactivé ni retiré par SCIM. Les groupes ne peuvent contenir que des membres de cette organisation. Un changement de nom d’utilisateur est refusé si la nouvelle adresse e-mail est déjà utilisée ou si le compte appartient à plusieurs organisations, afin de protéger son identité de connexion partagée.

## Vérifier et résoudre les problèmes

Ouvre une session de navigateur séparée, choisis **Continuer avec SSO**, puis l’organisation grâce à son nom d’affichage. Termine la connexion et vérifie le rôle et les équipes obtenus. **Tester la connexion** vérifie les paramètres de connexion, sans prouver qu’une personne reçoit les bons accès.

| Symptôme | Points à vérifier |
| --- | --- |
| Redirection incorrecte, notamment `AADSTS50011` | Compare le rappel enregistré à l’URL exacte de Tale : domaine, schéma, chemin et barre oblique finale. |
| Échec du test de connexion | Vérifie l’émetteur/les points de terminaison, l’ID client, la valeur et l’expiration du secret, ainsi que le consentement requis chez le fournisseur. |
| Erreur de liaison au navigateur | Recommence dans le même navigateur et autorise les cookies nécessaires aux redirections. |
| Mauvais rôle ou équipe absente | Vérifie les claims réellement fournis, les règles de rôles, les exclusions et les autorisations de groupes. |
| SCIM ne se connecte pas | Vérifie l’URL de base, le jeton Bearer et l’activation du provisionnement. |
| URL de rappel absente ou avertissement de configuration serveur | Demande à l’opérateur de vérifier la [configuration de l’authentification](/fr/self-hosted/configuration/authentication). |

**Désactiver la connexion** empêche les nouvelles connexions SSO mais conserve les sessions actives. **Supprimer** efface la configuration de la connexion et ses identifiants. Prévois une autre méthode de connexion fonctionnelle avant d’utiliser l’une de ces actions.

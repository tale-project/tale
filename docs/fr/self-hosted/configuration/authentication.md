---
title: Choisir l’authentification
description: Configure des comptes locaux, le SSO d’entreprise ou un proxy d’authentification de confiance.
---
Tale prend en charge les comptes locaux par e-mail et mot de passe, le SSO propre à chaque organisation et les identités transmises par un reverse proxy de confiance. Choisis selon l’endroit où ton équipe gère ses identités et la personne responsable des comptes. L’authentification et le provisionnement sont distincts : le SSO authentifie, tandis que les invitations, le provisionnement à la connexion ou SCIM gèrent l’appartenance.

## Choisir l’intégration adaptée

| Environnement | Configuration | Prérequis principal |
| --- | --- | --- |
| Comptes locaux gérés dans Tale | Connexion locale et invitations | Secrets stables et URL de l’instance accessible. |
| Fournisseur d’identité d’entreprise existant | SSO : Microsoft Entra ID, OIDC générique, OAuth2 ou SAML 2.0 | Une application IdP avec les URL exactes de callback ou de métadonnées. |
| Proxy qui authentifie déjà chaque requête | En-têtes de confiance | Une liaison privée vers le backend et un secret interne partagé. |

Ces mécanismes ne constituent pas un sélecteur unique pour toute l’instance. Le SSO se configure par organisation ; les en-têtes de confiance s’activent au niveau du déploiement. Prépare et teste la correspondance des identités avant de changer le mécanisme de comptes existants.

## Fixer d’abord l’URL publique

Définis `SITE_URL` et l’éventuel chemin de base pris en charge avec l’adresse réellement utilisée. Termine la [configuration TLS et des domaines](/fr/self-hosted/configuration/tls-and-domains) avant d’enregistrer les redirections chez le fournisseur d’identité.

Garde `BETTER_AUTH_SECRET` identique entre les processus backend de l’instance. Utilise le secret généré par le déploiement ou injecte-le depuis ton gestionnaire. Des valeurs différentes peuvent interrompre la connexion même si le fournisseur d’identité accepte la personne.

## Utiliser des comptes locaux

La connexion locale conserve des empreintes de mots de passe dans la base applicative. La [première configuration](/fr/self-hosted/install/first-admin) crée le Propriétaire initial ; les membres suivants rejoignent l’organisation sur invitation. Configure l’envoi d’e-mails si ton parcours d’invitation ou de récupération en dépend.

Vérifie avec un compte de test l’invitation, la connexion, la déconnexion et la récupération. Une session Propriétaire qui fonctionne ne prouve pas qu’un nouveau membre peut rejoindre l’organisation.

Tale n’envoie aucun courriel de vérification : une adresse est donc confirmée par qui crée le compte. Le premier Propriétaire issu de la configuration initiale, une personne ajoutée par un administrateur dans **Paramètres > Membres** et le compte créé par le déploiement valent tous comme confirmation, et le compte est utilisable immédiatement. Les applications connectées lisent cela dans l’attribut `email_verified` de l’identité délivrée par Tale : un collègue qui vient d’être ajouté peut donc s’y connecter tout de suite. Un compte issu du SSO d’entreprise, de SCIM ou d’en-têtes de confiance conserve en revanche ce qu’indique son annuaire.

## Connecter le SSO d’entreprise

Configure l’organisation sous **Paramètres > SSO d’entreprise**. Microsoft Entra ID et OIDC générique découvrent les endpoints depuis l’émetteur ; OAuth2 utilise des URL explicites d’autorisation, de token et de userinfo. SAML utilise des métadonnées, une URL de réception des assertions et des certificats de signature.

<Frame caption="Copie les URL de l’instance en cours pour inclure son domaine et son chemin de déploiement.">

![La page du SSO d’entreprise affiche le choix du protocole et les champs de connexion Microsoft Entra ID.](/images/platform/settings-enterprise-sso.webp)

</Frame>

Utilise les URL de callback et de métadonnées affichées. Les callbacks OIDC natifs utilisent `/api/sso/callback` ; la route de compatibilité `/http_api/api/sso/callback` reste prise en charge pour les anciennes inscriptions. L’URL enregistrée chez l’IdP doit correspondre à celle utilisée dans le parcours.

Suis [SSO d’entreprise et provisionnement](/fr/platform/admin/enterprise-sso) pour les protocoles, les claims, les rôles par défaut, les équipes et SCIM. Teste la connexion dans une session distincte avant de fermer ta session d’administration. Une découverte validée ne prouve ni les claims, ni les droits sur les groupes, ni une connexion complète.

## Faire confiance à un proxy d’authentification

Active les en-têtes de confiance uniquement si ton proxy gère l’authentification et protège sa liaison vers Tale. Les en-têtes par défaut sont `Remote-Email`, `Remote-Name`, `Remote-Role` et `Remote-Teams`.

Définis `TRUSTED_HEADERS_ENABLED=true` et injecte `TRUSTED_HEADERS_INTERNAL_SECRET`. Le proxy doit transmettre ce secret dans `Remote-Internal-Secret`. La [référence d’environnement](/fr/self-hosted/configuration/environment-reference) indique les variables `TRUSTED_*_HEADER` qui permettent de renommer ces en-têtes.

<Warning>

Le proxy doit supprimer les en-têtes d’identité fournis par le client et définir ses propres valeurs authentifiées. Réserve l’accès au backend à ce proxy. Une personne capable d’envoyer les bons en-têtes et le secret interne peut usurper l’identité indiquée.

</Warning>

`Remote-Teams` contient des entrées `id:name` séparées par des virgules, par exemple `t-fin:Finance,t-ops:Operations`. Un en-tête absent laisse les équipes inchangées ; un en-tête présent mais vide retire les appartenances accordées par cette synchronisation. Des entrées invalides peuvent donc supprimer ces appartenances. Celles accordées manuellement restent intactes.

## Diagnostiquer les échecs de connexion

| Symptôme | Première vérification |
| --- | --- |
| L’IdP refuse une redirection | Compare l’URL enregistrée à celle de Tale, protocole, hôte et chemin compris. |
| La redirection revient sans connecter | Vérifie l’accès au callback, les cookies et les noms de claims. |
| Un membre reçoit le mauvais rôle | Vérifie le rôle par défaut et les règles avec ses claims réels. |
| Les équipes synchronisées disparaissent | Inspecte le claim de groupes ou `Remote-Teams` ; distingue absence et valeur vide. |
| La connexion par en-têtes est refusée | Vérifie l’activation, le secret partagé et les noms configurés dans le proxy. |

Teste les changements de correspondance dans une organisation de staging et garde un accès administratif de secours déjà vérifié. Ces changements peuvent affecter tous les membres dont l’identité dépend de la connexion.

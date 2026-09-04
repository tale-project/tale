---
title: Authentification à deux facteurs
description: Inscription TOTP, passkeys, codes de secours, la politique d’application org-large et comment un admin réinitialise un membre qui a perdu son authenticator. Lis ceci quand tu câbles la 2FA pour l’org ou que tu récupères un compte.
---

L’authentification à deux facteurs ajoute une seconde preuve d’identité par-dessus le mot de passe — un code à six chiffres d’une appli authenticator, ou un passkey WebAuthn. Tale embarque TOTP (mots de passe à usage unique basés sur le temps) compatible avec Google Authenticator, 1Password, Authy et toute autre appli qui suit le standard, plus les passkeys comme alternative résistante au phishing. La page couvre l’inscription par utilisateur, les passkeys, les codes de secours qui récupèrent un compte quand le téléphone n’est plus là, la politique d’application org-large et la réinitialisation admin pour un membre verrouillé.

La 2FA est optionnelle par défaut. Les Administrateurs peuvent l’exiger pour toute l’organisation avec une fenêtre de grâce pour que les membres aient le temps de s’inscrire.

## Inscription par utilisateur

Pour activer la 2FA sur ton propre compte, ouvre **Compte > Sécurité**. Clique sur **Activer la deux-facteurs**, confirme ton mot de passe et scanne le code QR avec une appli authenticator. Saisis le code à six chiffres que l’appli affiche pour vérifier que le secret a été capté, puis sauvegarde les codes de secours que l’écran suivant présente. Les codes apparaissent une seule fois — télécharge-les ou copie-les avant de cliquer sur **Terminé**.

Le même écran porte **Désactiver** et **Régénérer les codes de secours**. Désactiver supprime le second facteur ; régénérer invalide chaque code de secours précédent. Les deux actions exigent le mot de passe du compte comme confirmation.

## Codes de secours

Les codes de secours sont des chaînes à usage unique que la plateforme frappe quand la 2FA est activée ou régénérée. Chacun remplace le code authenticator sur une seule connexion — utile quand le téléphone est perdu, l’authenticator désinstallé, ou que tu es coincé quelque part sans l’appareil. La plateforme surveille le compte restant et affiche une bannière de niveau bas quand il ne reste que quelques codes ; la bannière renvoie directement au flux de régénération.

Traite les codes de secours comme des mots de passe. Range-les dans un gestionnaire de mots de passe ou imprime-les et mets-les sous clé. Quiconque a ton mot de passe et un code de secours peut se connecter à ta place.

## Passkeys

Un passkey est un identifiant WebAuthn — Face ID, Touch ID, Windows Hello ou une clé de sécurité matérielle — qui signe un défi à chaque connexion au lieu de produire un code à taper. L’identifiant est lié à l’origine du site : un domaine de phishing qui lui ressemble n’obtient rien à rejouer. Un passkey résiste donc au phishing d’une façon que TOTP n’atteint pas, et il satisfait une politique de deux facteurs appliquée exactement comme TOTP.

Pour en enregistrer un, ouvre **Compte > Sécurité** et clique sur **Ajouter un passkey**. Donne à l’identifiant un nom que tu reconnaîtras plus tard, puis choisis le **Type d'authentificateur** : **Indifférent (recommandé)** laisse le navigateur proposer tout ce qui est disponible, **Cet appareil (Face ID, Touch ID, Windows Hello)** restreint la cérémonie à l’authentificateur intégré, et **Clé de sécurité ou téléphone** à un authentificateur itinérant. Le navigateur déroule la cérémonie d’enregistrement à partir de là. Chaque entrée de la même liste porte un bouton-icône **Supprimer** pour révoquer tes propres passkeys ; il demande une confirmation avant de supprimer le passkey.

Un passkey enregistré fonctionne à trois portes. Sur l’écran de connexion, **Se connecter avec un passkey** te connecte sans taper le mot de passe — l’identifiant est lui-même une preuve forte. Sur l’écran de vérification après une connexion par mot de passe, **Utiliser un passkey à la place** remplace le code à six chiffres. Et sur l’écran d’inscription vers lequel une politique appliquée route les membres non inscrits, **Enregistrer un passkey à la place** se trouve à côté de la configuration TOTP — un membre qui n’enregistre qu’un passkey, jamais TOTP, passe la politique.

Quand un membre perd un appareil qui porte un passkey, un Administrateur révoque l’identifiant : ouvre **Paramètres > Membres**, clique sur **Modifier le membre** et supprime l’identifiant dans la section **Passkeys** du dialogue. Tale supprime l’identifiant et met fin à chaque session active du membre, donc un authentificateur perdu ou volé ne garde aucune session en vie. La révocation admin atterrit dans le journal d’audit sous `passkey.revoked_by_admin`.

## La politique d’application pour l’org

Les Administrateurs peuvent exiger le second facteur pour chaque membre authentifié par mot de passe de l’organisation. Ouvre **Paramètres > Gouvernance > Sécurité** et, sous **Authentification à deux facteurs**, bascule **Exiger l'authentification à deux facteurs**. La politique porte une période de grâce (en jours) qui donne à chaque membre du temps pour s’inscrire à partir de sa première connexion sous la politique ; mets-la à zéro pour une application immédiate.

<Frame caption="Paramètres > Gouvernance > Sécurité — limites de tentatives de connexion et politique de mot de passe ; la politique d’authentification à deux facteurs se trouve plus bas sur la même page.">

![La page de gouvernance Sécurité montrant les champs de limite de tentatives de connexion et les exigences de classes de caractères de la politique de mot de passe ; la politique de deux facteurs se trouve plus bas sur la même page.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Champ                                     | Type    | Requis | Description                                                                                                                          |
| ----------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Exiger l’authentification à deux facteurs | Bascule | oui    | Off garde la 2FA optionnelle pour chaque membre ; on active la politique.                                                            |
| Période de grâce (jours)                  | Entier  | oui    | Jours à partir de la première connexion d’un membre sous la politique avant que l’inscription soit requise. Zéro veut dire immédiat. |
| Exempter les utilisateurs SSO-seuls       | Bascule | non    | Quand on, les membres dont le seul compte est une identité fédérée s’appuient sur l’IdP en amont pour la MFA.                        |

Un membre dans la fenêtre de grâce voit une bannière de compte à rebours dans l’appli qui pointe vers le flux d’inscription. Une fois la grâce expirée, la connexion suivante passe par l’écran d’inscription et le membre ne peut pas continuer tant qu’il n’est pas inscrit.

## Réinitialisation admin pour un membre verrouillé

Quand un membre perd son téléphone et ses codes de secours, un Administrateur efface le second facteur sur son compte. Ouvre **Paramètres > Membres**, clique sur **Modifier le membre** puis sur **Réinitialiser le double facteur** dans le dialogue. Tale désactive la 2FA pour le compte et met fin à chaque session active, donc le membre se réinscrit à sa prochaine connexion.

La réinitialisation est enregistrée dans le journal d’audit sous `2fa_reset_by_admin`. Va vers ça comme action de récupération — le membre doit se réinscrire immédiatement une fois revenu.

## Où ça s’inscrit

La 2FA est une couche au-dessus du mot de passe — même écran de connexion, deuxième étape. Combine-la avec [membres et rôles](/fr/platform/admin/members-and-roles) (l’admin qui réinitialise le second facteur est le même admin qui gère le compte), avec [politiques et limites](/fr/platform/admin/governance/policies-and-limits) (la politique d’application vit dans la surface gouvernance) et avec [journaux d’audit](/fr/platform/admin/governance/audit-logs) (chaque inscription, désactivation et réinitialisation admin y atterrit).

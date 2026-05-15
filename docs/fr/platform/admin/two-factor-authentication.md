---
title: Authentification à double facteur
description: Imposer un second facteur TOTP à la connexion par mot de passe, inscrire ton propre compte, gérer les codes de secours et réinitialiser un membre qui a perdu son appareil.
---

L'authentification à double facteur ajoute au flux de connexion par mot de passe un code à usage unique tiré d'une application d'authentification. Tale utilise TOTP — le même protocole qu'implémentent Google Authenticator, 1Password, Authy et la plupart des gestionnaires de mot de passe — couplé à des codes de secours à usage unique pour la récupération. Le facteur ne s'applique qu'aux comptes qui se connectent par mot de passe ; les utilisateurs authentifiés par SSO ou par en-têtes de confiance héritent de la décision MFA de leur fournisseur d'identité et ne voient jamais les invites Tale.

Deux surfaces comptent sur cette page. **Compte > Sécurité** est l'endroit où chaque utilisateur s'inscrit, régénère des codes de secours ou désactive le double facteur sur son propre compte. **Paramètres > Gouvernance > Authentification à double facteur** est l'endroit où les Admins font appliquer le double facteur à l'échelle de l'organisation, et **Paramètres > Membres** est l'endroit où les Admins réinitialisent le second facteur d'un membre qui a perdu son appareil.

## Inscrire ton propre compte

Ouvre le menu avatar et choisis **Compte**. Sous **Sécurité**, clique **Activer le double facteur**. Tale confirme ton mot de passe, puis affiche un code QR et un secret pour saisie manuelle.

1. Scanne le code QR avec une application d'authentification, ou colle le secret manuellement si tu ne peux pas scanner.
2. Saisis le code à 6 chiffres que l'application affiche. Tale le vérifie avant d'activer le double facteur, de sorte qu'un mauvais scan ne puisse pas te verrouiller — la boîte reste ouverte tant que le code ne correspond pas.
3. Enregistre les **codes de secours** que Tale affiche ensuite. Chaque code fonctionne une seule fois et constitue le seul chemin de retour dans ton compte si tu perds l'authentificateur. Tale n'affiche les codes qu'une fois — télécharge-les ou copie-les maintenant.

Depuis le même écran, tu peux **Régénérer les codes de secours** (invalide l'ancien lot) ou **Désactiver** (exige une nouvelle confirmation de mot de passe). Une bannière de codes faibles apparaît quand tu passes sous le seuil, de sorte que tu régénères avant que le dernier code ne soit consommé.

## Se connecter avec le double facteur

Après la saisie du mot de passe, Tale demande le code à 6 chiffres. L'écran de vérification a deux modes :

- **Application d'authentification** — le défaut. Tape le code courant depuis ton application.
- **Code de secours** — bascule sur **Utiliser un code de secours à la place** si tu n'as pas l'authentificateur. Chaque code est consommé à l'usage ; le réutiliser est refusé. Un rappel de codes faibles se déclenche en dessous de cinq codes restants.

Les échecs répétés sont limités par le même backoff que les tentatives de mauvais mot de passe. Les verrouillages sont consignés au journal d'audit sous la catégorie **Sécurité**.

## Faire appliquer le double facteur à l'échelle de l'organisation

Ouvre **Paramètres > Gouvernance > Authentification à double facteur**. Le formulaire prend trois réglages :

- **Exiger l'authentification à double facteur** — l'interrupteur maître. Tant qu'il est éteint, le double facteur est optionnel pour chaque utilisateur.
- **Période de grâce (jours)** — combien de jours chaque utilisateur a depuis sa première connexion sous la politique avant que l'inscription ne soit imposée. Pose `0` pour application immédiate ; choisis une fenêtre plus longue quand tu déploies le double facteur dans une organisation existante, de sorte que les membres puissent s'inscrire sans perdre l'accès. Les membres dans leur fenêtre de grâce voient une bannière qui rappelle de configurer ; une fois la grâce écoulée, ils ne dépassent pas l'écran de connexion tant qu'ils ne se sont pas inscrits.
- **Exempter les utilisateurs SSO uniquement** — quand allumé, les comptes dont la seule identité est fédérée (Microsoft Entra ID, OIDC) sont exemptés parce que l'IdP en amont contrôle leur MFA. Un utilisateur qui a à la fois un compte SSO et un mot de passe n'est **jamais** exempté, parce que le mot de passe est une voie de contournement.

Clique **Enregistrer** pour appliquer.

## Réinitialiser le double facteur d'un membre

Ouvre **Paramètres > Membres**, clique le menu de ligne de l'utilisateur concerné et choisis **Réinitialiser le double facteur**. La boîte de confirmation explique la conséquence — le double facteur est désactivé pour cet utilisateur, chacune de ses sessions actives se termine, et il doit s'inscrire à nouveau à sa prochaine connexion. Sers-t'en quand un membre perd son authentificateur et a épuisé ses codes de secours. Chaque réinitialisation est inscrite au journal d'audit, de sorte que les équipes sécurité puissent suivre la piste.

## Événements d'audit

Chaque action double facteur émet une entrée structurée au journal d'audit sous **Paramètres > Gouvernance > Journaux d'audit**, catégorie **Sécurité** :

| Action                   | Quand elle se déclenche                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `2fa_enrolled`           | Un utilisateur termine l'inscription.                                                  |
| `2fa_disabled`           | Un utilisateur désactive le double facteur sur son propre compte.                      |
| `2fa_verified`           | Une vérification TOTP réussie à la connexion.                                          |
| `2fa_verify_failed`      | Une vérification TOTP échouée.                                                         |
| `2fa_backup_code_used`   | Un code de secours a été consommé avec succès.                                         |
| `2fa_backup_code_failed` | Une tentative de code de secours a échoué.                                             |
| `2fa_reset_by_admin`     | Un Admin a réinitialisé le double facteur d'un membre depuis **Paramètres > Membres**. |

## Où cela s'insère

L'authentification à double facteur est la couche de second facteur posée sur la connexion par mot de passe. Elle interagit avec deux autres surfaces : [Authentification](/fr/self-hosted/admin/authentication) décide si un utilisateur se connecte par mot de passe (où le double facteur s'applique), SSO ou en-têtes de confiance (où l'IdP en amont possède le second facteur) ; [Membres et rôles](/fr/platform/admin/members-and-roles) est l'endroit où l'Admin réinitialise le double facteur d'un membre quand l'appareil est perdu. La politique d'application à l'échelle de l'organisation vit sur cette page ; la surface de gouvernance plus large qui tient budgets, rétention et garde-fous est [Gouvernance](/fr/platform/admin/governance).

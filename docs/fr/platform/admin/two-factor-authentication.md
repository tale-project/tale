---
title: Authentification à double facteur
description: Imposer un second facteur à la connexion, activer ton propre compte et réinitialiser un membre qui a perdu son appareil.
---

L’authentification à double facteur (2FA) ajoute un code à usage unique provenant d’une application d’authentification au flux de connexion par mot de passe. Tale utilise un second facteur basé sur TOTP — le même protocole que celui implémenté par Google Authenticator, 1Password, Authy et la plupart des gestionnaires de mots de passe — accompagné de codes de secours à usage unique pour la récupération. La 2FA s’applique uniquement aux comptes qui se connectent par mot de passe ; les utilisateurs authentifiés via SSO ou trusted headers héritent de la décision 2FA de leur fournisseur d’identité et ne voient jamais les écrans Tale.

Deux endroits sont à connaître. **Compte > Sécurité** est l’écran où chaque utilisateur active la 2FA, régénère ses codes de secours ou la désactive sur son propre compte. **Paramètres > Gouvernance** est l’endroit où les admins imposent la 2FA à toute l’organisation et réinitialisent le second facteur d’un membre qui a perdu son appareil.

## Activer son propre compte

Ouvre **Compte > Sécurité** depuis le menu de l’avatar et clique sur **Activer le double facteur**. Tale demande la confirmation de ton mot de passe, puis affiche un code QR et un secret pour saisie manuelle.

1. Scanne le code QR avec une application d’authentification, ou colle le secret manuellement si tu ne peux pas scanner.
2. Saisis le code à 6 chiffres affiché par l’app. Tale le vérifie avant d’activer la 2FA, donc un mauvais scan ne peut jamais te bloquer dehors.
3. Conserve les **codes de secours** que Tale affiche ensuite. Chaque code fonctionne une seule fois et constitue le seul retour vers ton compte si tu perds ton authentificateur. Tale n’affiche les codes qu’une fois — télécharge-les ou imprime-les maintenant.

Sur la même page tu peux **régénérer les codes de secours** (l’ancien lot devient invalide) ou **désactiver le double facteur** (mot de passe requis). Régénère dès que tu as consommé quelques codes — Tale affiche un bandeau quand tu passes sous le seuil.

## Se connecter avec la 2FA

Après le mot de passe, Tale demande le code à 6 chiffres. L’écran de vérification a deux modes :

- **Application d’authentification** — par défaut. Saisis le code en cours dans ton app.
- **Code de secours** — bascule _Utiliser plutôt un code de secours_ si tu n’as pas ton authentificateur. Chaque code est consommé à l’utilisation ; le réutiliser est rejeté. Tale te rappelle de régénérer dès qu’il en reste moins de cinq.

Les échecs répétés sont rate-limités avec le même back-off que les mots de passe erronés. Les blocages sont consignés dans l’audit log.

## Imposer la 2FA à toute l’organisation

Ouvre **Paramètres > Gouvernance > Politique double facteur**. Active **Double facteur requis** pour rendre la 2FA obligatoire à chaque membre qui se connecte par mot de passe. Deux réglages pilotent le déploiement :

- **Période de grâce (jours)** — combien de jours chaque utilisateur a, à partir de sa première connexion sous la politique, avant que l’enrôlement soit imposé. Mets `0` pour appliquer immédiatement ; choisis une fenêtre plus longue lors d’un déploiement dans une organisation existante pour que les membres puissent s’inscrire sans perdre l’accès. Pendant la grâce, l’utilisateur voit un bandeau l’invitant à configurer ; à expiration, le dashboard n’est plus accessible tant que la 2FA n’est pas activée.
- **Réinitialiser le double facteur d’un membre** — dans **Paramètres > Membres**, le menu de la ligne propose une action **Réinitialiser le double facteur** réservée aux admins. Utilise-la quand quelqu’un a perdu son authentificateur et n’a plus de codes de secours. Le reset désactive la 2FA pour ce compte, met fin à toutes ses sessions actives et l’oblige à se réinscrire à la prochaine connexion. Chaque reset est consigné dans l’audit log pour que les équipes sécurité puissent suivre la trace.

La politique ne concerne que la connexion par mot de passe. Les utilisateurs SSO et trusted headers ne sont exemptés **que si l’option _Exempter les utilisateurs SSO_ est activée dans la politique** — Tale considère alors que leur fournisseur d’identité gère le second facteur. Un utilisateur qui a à la fois un compte SSO et un mot de passe n’est jamais exempté, parce que le mot de passe reste un chemin de contournement.

## Événements d’audit

Chaque action 2FA produit une entrée structurée visible sous **Paramètres > Gouvernance > Audit logs** :

| Action                   | Quand l’événement est émis                                                  |
| ------------------------ | --------------------------------------------------------------------------- |
| `2fa_enrolled`           | Un utilisateur termine son enrôlement.                                      |
| `2fa_disabled`           | Un utilisateur désactive la 2FA sur son propre compte.                      |
| `2fa_verified`           | Vérification TOTP réussie à la connexion.                                   |
| `2fa_verify_failed`      | Vérification TOTP échouée.                                                  |
| `2fa_backup_code_used`   | Un code de secours a été consommé avec succès.                              |
| `2fa_backup_code_failed` | Une tentative de code de secours a échoué.                                  |
| `2fa_reset_by_admin`     | Un admin a réinitialisé la 2FA d’un membre depuis **Paramètres > Membres**. |

## Voir aussi

- [Authentification](/fr/self-hosted/admin/authentication) — connexion par mot de passe, SSO et trusted headers.
- [Membres et rôles](/fr/platform/admin/members-and-roles) — réinitialiser la 2FA d’un membre depuis le menu de la ligne.
- [Gouvernance](/fr/platform/admin/governance) — définir la politique et lire l’audit log.

---
title: Authentification à double facteur
description: Protège ton compte avec une application ou un passkey, conserve tes codes de secours et configure la règle de ton organisation.
---

Protège ton compte avec une application d’authentification ou un passkey. Chaque membre configure ses méthodes de connexion dans **Paramètres > Compte**. Les admins peuvent exiger un second facteur et aider un membre à récupérer son accès.

## Choisir une méthode de connexion

| Méthode | Ce qu’il te faut | Comment l’utiliser |
| --- | --- | --- |
| Application d’authentification | Un mot de passe Tale et une application compatible avec les codes temporels (TOTP) | Saisis ton mot de passe, puis le code à six chiffres de l’application. |
| Passkey | Un appareil compatible ou une clé de sécurité | Valide la demande du navigateur avec ton appareil ou ta clé. Tu peux aussi l’utiliser après une connexion par mot de passe. |
| Code de secours | Un code conservé lors de la configuration de l’application | Utilise-le une fois à la place d’un code d’authentification si tu n’as plus accès à l’application. |

Un passkey satisfait la règle de double facteur de Tale, même sans application d’authentification configurée. Les comptes qui utilisent uniquement le SSO ne voient pas la configuration de cette application, car elle exige un mot de passe Tale. L’exemption SSO de ton organisation détermine si tu as besoin d’un passkey Tale.

## Configurer une application d’authentification

1. Ouvre **Paramètres > Compte**, repère **Sécurité** et choisis **Activer le double facteur**.
2. Saisis ton mot de passe Tale actuel et choisis **Confirmer**.
3. Scanne le code QR avec ton application d’authentification. Si tu ne peux pas le scanner, saisis manuellement le secret de configuration affiché dans l’application.
4. Saisis son code à six chiffres actuel dans **Code de vérification**, puis choisis **Vérifier et activer**.
5. Télécharge ou copie les codes de secours avant de choisir **Terminé**. Tale ne les affichera plus.

La page du compte confirme maintenant que le double facteur est actif. À ta prochaine connexion par mot de passe, utilise un code provenant de la même entrée dans ton application.

<Tip>
Conserve tes codes de secours dans un endroit accessible sans ton appareil de connexion, par exemple un gestionnaire de mots de passe disponible sur un autre appareil de confiance.
</Tip>

## Ajouter un passkey

1. Dans **Paramètres > Compte > Sécurité**, choisis **Ajouter un passkey**.
2. Dans **Nom du passkey**, indique un nom reconnaissable, par exemple `Portable professionnel`.
3. Garde **Type d'authentificateur** sur **Indifférent (recommandé)** pour voir les possibilités du navigateur, ou choisis l’authentificateur intégré à l’appareil ou une clé de sécurité/un téléphone.
4. Choisis **Ajouter un passkey** et termine la procédure du navigateur.

Le passkey apparaît dans la liste de ton compte. Sur la page de connexion, choisis **Se connecter avec un passkey**. Après une connexion par mot de passe, tu peux aussi choisir **Utiliser un passkey à la place** sur l’écran de vérification.

Pour ne plus utiliser un passkey, choisis son bouton **Supprimer** et confirme. S’il s’agissait de ton seul second facteur et que ton organisation en exige un, tu dois en configurer un autre.

## Récupérer ton accès et remplacer les codes

Sur l’écran de vérification, choisis **Utiliser un code de secours à la place** et saisis un code conservé. Chaque code fonctionne une fois. Après la connexion, ouvre **Paramètres > Compte** et choisis **Régénérer les codes de secours** si tu as besoin d’un nouveau lot. Confirme ton mot de passe et conserve les nouveaux codes. Cette opération invalide tous les anciens codes, même ceux que tu n’as pas utilisés.

Si un code est refusé, vérifie que tu utilises l’entrée de ce compte Tale, saisis le code actuel et contrôle l’horloge de ton appareil. Des échecs répétés peuvent bloquer temporairement la vérification. Suis alors le message affiché au lieu de multiplier les tentatives.

Si tu n’as plus d’application, de passkey ni de code de secours utilisable, contacte un admin de ton organisation. Ne lui envoie ni ton mot de passe, ni ton secret de configuration, ni tes codes restants.

## Exiger un second facteur pour l’organisation

Les admins configurent la règle dans **Paramètres > Gouvernance > Sécurité**. Prévois un contact en cas de perte d’accès et laisse aux membres le temps de configurer une méthode avant de l’activer.

<Frame caption="Les paramètres de sécurité regroupent les règles de mot de passe, de connexion et de double facteur. Descends jusqu'à Authentification à double facteur pour régler l'obligation de configuration.">

![Paramètres de sécurité présentant les limites de connexion et les exigences de mot de passe au-dessus de la règle de double facteur.](/images/platform/governance-security-monitoring.webp)

</Frame>

| Réglage | Effet |
| --- | --- |
| **Exiger l'authentification à double facteur** | Active l’obligation après confirmation. Un passkey ou une application d’authentification enregistrés y répondent. |
| **Période de grâce (jours)** | Délai de configuration à partir de la première connexion du membre sous cette règle. Zéro impose une configuration immédiate. |
| **Exempter les utilisateurs SSO uniquement** | Les membres sans mot de passe Tale s’appuient sur l’authentification de leur fournisseur d’identité. |

Pendant ce délai, les membres voient un rappel. Une fois le délai écoulé, Tale bloque l’accès à l’organisation jusqu’à la configuration. Désactiver ton application d’authentification personnelle ne te dispense pas de cette règle.

## Aider un membre qui a perdu son accès

Vérifie d’abord l’identité de la personne selon la procédure de récupération de ton organisation. Ouvre ensuite **Paramètres > Membres**, modifie le membre et choisis **Réinitialiser le double facteur**. La confirmation efface la configuration de son application et met fin à toutes ses sessions actives. La personne peut se reconnecter et configurer une nouvelle application. Si le double facteur est obligatoire, elle doit terminer cette configuration avant de continuer.

Pour un passkey perdu, supprime plutôt cet identifiant dans la section **Passkeys** de la fenêtre du membre. Cette suppression par un admin ferme aussi toutes les sessions du membre. Consulte les actions de récupération dans les [journaux d’audit](/fr/platform/admin/governance/audit-logs).

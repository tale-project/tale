---
title: Ouvrir les documents Tale avec WebDAV
description: Génère un mot de passe par appareil, connecte un client WebDAV et vérifie les documents accessibles.
---

WebDAV permet à un client de fichiers compatible de lire et modifier les documents de l’organisation comme un dossier distant. Les changements concernent le même stockage que **Connaissances > Documents**. Les fichiers de connaissances propres à un projet ne figurent pas dans ce montage.

## Obtenir les données de connexion

Ouvre **Paramètres > API > WebDAV**. Les Propriétaires, Admins et Développeurs peuvent générer leurs propres identifiants d’appareil. Copie l’URL affichée avec le slug de l’organisation et le chemin `/documents/`. Ne la reconstruis pas avec un identifiant d’organisation et n’utilise pas l’adresse d’une autre organisation.

<Frame caption="Paramètres > API > WebDAV — les détails de connexion préremplis en haut, le générateur de mots de passe applicatifs en dessous.">

![Les paramètres WebDAV affichent l’URL de connexion et le nom d’utilisateur au-dessus de trois mots de passe applicatifs. Retired design workstation est révoqué ; Design workstation et MacBook Pro restent actifs avec une action de révocation.](/images/platform/settings-webdav.webp)

</Frame>

Utilise l’adresse e-mail de ton compte Tale comme nom d’utilisateur et un mot de passe applicatif comme mot de passe. Le mot de passe habituel du compte ne fonctionne pas pour WebDAV. Sur un service déployé, utilise HTTPS. Ne place pas les identifiants dans une URL ni dans l’historique de commandes.

## Générer un mot de passe par appareil

1. Choisis **Générer** et saisis un **Libellé**, par exemple `Portable design`.
2. Génère le mot de passe et copie-le avant de fermer le résultat. Sa valeur complète n’apparaît qu’une fois.
3. Enregistre-le dans le gestionnaire d’identifiants du client, puis choisis **Je l'ai sauvegardé**.

La liste conserve le libellé, le préfixe et les dates d’utilisation, pas un mot de passe récupérable. En cas de perte, génère un remplacement et révoque l’ancien après avoir mis le client à jour. Des mots de passe distincts permettent de retirer l’accès d’un seul appareil.

## Configurer le client

<Tabs>

<Tab title="Finder sur macOS">

Dans Finder, utilise **⌘K** pour ouvrir la connexion à un serveur. Colle l’URL WebDAV et connecte-toi avec ton e-mail et le mot de passe applicatif. Ouvre le dossier monté et vérifie un document connu avant d’y copier des fichiers. N’enregistre les identifiants que sur un appareil de confiance.

</Tab>

<Tab title="Windows">

Connecte un lecteur réseau dans l’Explorateur avec l’adresse WebDAV HTTPS et les identifiants générés. Le service Windows WebClient doit être disponible. En cas d’échec ou de transfert volumineux bloqué, examine les [prérequis et limites Microsoft](https://learn.microsoft.com/en-us/iis/publish/using-webdav/using-the-webdav-redirector) avec l’équipe informatique, ou utilise un client WebDAV dédié. Conserve HTTPS.

</Tab>

<Tab title="Linux">

Un gestionnaire de fichiers compatible utilise l’hôte et le chemin affichés. GNOME Files emploie `davs://` pour WebDAV sécurisé, et KDE Dolphin `webdavs://`. Si le dialogue sépare serveur et dossier, saisis l’hôte comme serveur et `/dav/<orgSlug>/documents/` comme dossier, avec HTTPS et le port approprié.

</Tab>

<Tab title="iPhone et iPad">

Choisis un client qui prend explicitement en charge WebDAV et un mot de passe propre à l’appareil. La page Documents de Tale dans le navigateur convient aussi aux accès occasionnels. Le dialogue serveur générique de Fichiers ne garantit pas WebDAV. L’envoi direct depuis Pages, Numbers et Keynote [n’est plus pris en charge](https://support.apple.com/en-us/101948).

</Tab>

<Tab title="rclone">

Lance `rclone config` et crée une connexion WebDAV avec l’URL Tale, ton e-mail et le mot de passe applicatif. Choisis le fournisseur `other` et saisis le mot de passe à l’invite. Le [guide WebDAV de rclone](https://rclone.org/webdav/) explique la liste et la copie ; commence par un petit dossier de test.

</Tab>

</Tabs>

## Vérifier un petit transfert

Ouvre ou télécharge un document que tu peux déjà lire dans Tale. Si ton rôle permet l’écriture, téléverse un petit fichier texte au nom unique dans un dossier de test. Vérifie son nom et son contenu sous **Connaissances > Documents**, puis son état d’indexation avant de l’attendre dans la recherche.

L’envoi WebDAV suit les permissions et l’indexation des documents ; sa source est enregistrée comme `webdav`. Un transfert terminé ne signifie pas que l’indexation est achevée. Si un fichier de projet manque, ouvre plutôt les connaissances de ce projet.

## Gérer les verrous et les fichiers supprimés

Un éditeur compatible peut verrouiller un fichier pendant sa modification. Une écriture concurrente reçoit **423 Locked**. Termine ou ferme l’autre session plutôt que de répéter l’écrasement. Révoquer un mot de passe applicatif libère aussi ses verrous.

La zone `.trash/` liste en lecture seule les documents supprimés provisoirement. Télécharge un fichier encore conservé pour l’examiner et utilise Tale pour le restaurer. Cette zone ne récupère pas un fichier déjà supprimé définitivement.

## Révoquer ou réparer une connexion

Choisis **Révoquer** sur la ligne du mot de passe et confirme. Les requêtes suivantes avec ce mot de passe sont refusées ; les autres mots de passe restent utilisables. La révocation est irréversible. Configure un nouveau mot de passe dans le client si nécessaire. La génération et la révocation d’un mot de passe d’application laissent chacune une entrée dans le journal d’audit, sous **Paramètres > Gouvernance > Journaux**.

En cas de demandes de connexion répétées, vérifie l’URL exacte, ton appartenance à l’organisation et une éventuelle révocation. Un refus de permission après authentification diffère d’un mot de passe incorrect. La [référence API WebDAV](/fr/develop/webdav-api) explique les codes et le diagnostic du protocole. Les logiciels qui utilisent REST emploient plutôt des [clés API](/fr/platform/admin/api-keys).

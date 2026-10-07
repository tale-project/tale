---
title: Gérer ton compte et tes préférences
description: Modifie ton nom, protège ta connexion, choisis une langue et comprends les réglages personnels de Tale.
---

Les réglages du compte déterminent le nom visible par tes collègues et ta façon de te connecter. Le menu de profil permet aussi de changer d’organisation et de langue, et affiche les équipes dont tu fais partie. Ces commandes sont accessibles sans rôle d’admin.

## Modifier le nom visible par tes collègues

Ouvre **Paramètres > Compte**. Sous **Profil**, modifie **Nom**, puis clique sur **Enregistrer** en haut de la page. La commande d’abandon restaure la valeur enregistrée. L’adresse e-mail reste en lecture seule, car elle identifie le compte utilisé pour la connexion et les notifications.

Ton nom est visible par les collègues et ne doit pas dépasser 100 caractères. Ce n’est pas une instruction privée destinée à l’assistant.

## Quand un changement de mot de passe est requis

Si un administrateur définit ou réinitialise ton mot de passe, ou si celui-ci expire selon la politique de rotation de ton organisation, l’écran **Changement de mot de passe requis** s’affiche à la connexion. Saisis un nouveau mot de passe qui respecte les exigences affichées, confirme-le, puis sélectionne **Envoyer** pour continuer. Les messages exacts figurent dans [Membres et rôles](/fr/platform/admin/members-and-roles).

## Protéger la connexion

La section **Mot de passe** propose **Changer le mot de passe**, ou **Définir le mot de passe** si ton compte n’en possède pas encore. Respecte les exigences affichées dans le dialogue. Elles proviennent de la politique de mot de passe de ton organisation. Si tu appartiens à plusieurs organisations, ton mot de passe doit respecter les exigences de chacune d’elles. Changer le mot de passe ferme tes sessions : garde le nouveau à portée de main avant de confirmer. Un mot de passe actuel erroné compte pour le verrouillage temporaire, comme un échec de connexion.

Configure une application sous **Authentification à deux facteurs** ou ajoute une passkey dans la section correspondante. Conserve les codes de secours dans un endroit accessible sans connexion à Tale. [Authentification à deux facteurs](/fr/platform/admin/two-factor-authentication) couvre la configuration, la récupération et les exigences de l’organisation.

## Changer de langue ou d’espace de travail

Ouvre le menu de profil depuis ton avatar. **Langue** change la langue de l’interface. Si tu appartiens à plusieurs organisations, **Organisation** change d’espace de travail. La ligne **Équipes** nomme tes équipes et ouvre la page du compte ; elle ne bascule vers rien, car une équipe n’est pas un espace de travail.

Vérifie le nom de l’organisation avant de modifier des réglages ou d’ajouter du contenu.

## Voir ton rôle {#role}

**Paramètres > Compte > Ton rôle** affiche ton rôle dans cette organisation, par exemple Éditeur ou Membre. Ton rôle détermine ce que tu peux faire ; tes équipes déterminent quels contenus d’équipe tu vois. Les admins attribuent les rôles dans [Membres et rôles](/fr/platform/admin/members-and-roles). Avec l’authentification unique, ton fournisseur d’identité peut aussi définir ton rôle à chaque connexion. Les propriétaires et les admins voient le bouton **Gérer les membres** à côté du titre de la section.

## Voir tes équipes {#teams}

**Paramètres > Compte > Tes équipes** liste les équipes dont tu fais partie. Les équipes déterminent quels documents d’équipe, projets et files de la boîte de réception tu vois ; ce qui est partagé avec toute l’organisation te reste visible dans tous les cas. Si tu n’es dans aucune équipe, la section le dit. Si tes équipes ne peuvent pas être chargées, la section l’indique au lieu d’affirmer que tu n’es dans aucune équipe. Choisis **Réessayer** pour les charger. Quand une actualisation échoue, les équipes déjà affichées restent visibles, avec un message indiquant qu’elles ne sont peut-être plus à jour.

Pour restreindre une liste à certains travaux, utilise son filtre **Équipes** : **Toute l'organisation** n’affiche que les éléments sans équipe, **Mes équipes** affiche ceux qu’une de tes équipes peut voir, et chaque équipe figure par son nom. La boîte de réception propose un filtre **Responsable** derrière son champ de recherche, qui réunit personnes et équipes. Un filtre change la vue, sans accorder l’accès aux données d’une autre équipe.

Les propriétaires et les admins gèrent les membres dans [Équipes](/fr/platform/admin/teams) ; le bouton **Gérer les équipes** de la section les y mène.

## Définir des instructions personnalisées pour l’assistant de chat

Ouvre **Paramètres > Personnalisation**. Les **Instructions personnalisées** sont des instructions permanentes que l’assistant de chat suit dans chacune de ses réponses, par exemple un ton préféré, un langage de programmation par défaut ou le niveau de détail souhaité. L’interrupteur peut suivre la valeur par défaut de l’organisation ou enregistrer ton propre choix ; l’indication située en dessous précise ce qui s’applique. Le champ de texte apparaît tant que la fonction est activée. Saisis tes instructions, puis clique sur **Enregistrer** dans l’en-tête de la page.

<Frame caption="La page Personnalisation contient tes instructions personnalisées et l’interrupteur qui les active.">

![La page Personnalisation affiche l’interrupteur des instructions personnalisées et son champ de texte.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

Tes instructions ne remplacent jamais les instructions obligatoires de l’organisation ni **Général > Instructions** d’un projet ; en cas de conflit, celles-ci prévalent. Désactiver l’interrupteur conserve le texte pour plus tard sans l’appliquer.

</Note>

## Consulter tes limites d’utilisation {#usage-limits}

Ouvre **Paramètres > Utilisation** pour voir ce que tu as déjà utilisé des limites que ton organisation t’applique. Si aucune limite ne te concerne, la page l’indique.

<Frame caption="Paramètres > Utilisation affiche chaque limite qui te concerne, avec son utilisation et sa prochaine réinitialisation.">

![La page Utilisation affiche les limites mensuelles personnelles de tokens, de coût et de requêtes, puis les limites mensuelles partagées de l’organisation, chacune avec une barre d’utilisation et sa date de réinitialisation. En dessous figure le stockage utilisé par rapport à la limite par personne. Un admin voit aussi le bouton Gérer les limites.](/images/platform/settings-usage.webp)

</Frame>

- **Tes limites** comptent tes propres chats, sorties vocales et exécutions d’agents, quelle que soit la façon de les lancer ; [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) explique à qui une exécution est imputée. Quand l’une d’elles est atteinte, tu ne peux plus lancer ce type d’activité avant sa réinitialisation : un message envoyé à ce moment-là est refusé avec un avis qui nomme la limite, et il reste dans la zone de saisie.
- **Limites partagées** comptent l’utilisation de toutes les personnes qu’elles couvrent, par exemple une équipe dont tu fais partie ou l’organisation entière. Elles peuvent donc être atteintes avant tes propres limites.
- **Stockage** compare les fichiers que tu as téléversés avec ta limite de stockage. Une fois celle-ci atteinte, les nouveaux téléversements de documents sont refusés.

Chaque limite d’utilisation indique la quantité utilisée, la limite et le moment de sa réinitialisation, dans ton fuseau horaire. Les périodes suivent l’heure UTC : les limites quotidiennes repartent à minuit, les limites hebdomadaires le lundi et les limites mensuelles le premier du mois. Si un admin a défini un seuil d’alerte, la barre passe à l’orange dès que ton utilisation l’atteint. Quand un bandeau au-dessus de la zone de saisie signale une limite, **Voir l'utilisation** ouvre cette page. Les admins voient aussi **Gérer les limites**, qui ouvre **Gouvernance > Politiques et limites**.

## Archiver des chats ou se déconnecter

Sous **Paramètres > Compte > Tes chats**, les actions **Archiver tous les chats** et **Supprimer tous les chats** portent sur tes propres chats dans l’organisation actuelle, y compris les chats de projet. L’archivage concerne les chats non archivés. La suppression inclut aussi les chats archivés et les déplace dans la corbeille, où tu peux les restaurer pendant le délai de conservation. Les chats sous conservation légale restent inchangés, et ceux avec une réponse en cours ne peuvent pas être supprimés.

Lis la confirmation avant de continuer. Le résultat indique combien de chats ont été modifiés et combien n’ont pas pu l’être. Utilise le menu d’un chat dans **Accueil** si tu souhaites seulement ranger celui-ci. Les chats archivés restent sous **Archivés**, en bas de la liste d’**Accueil**, où **Désarchiver** dans le menu d’un chat le fait revenir.

**Se déconnecter** dans le menu de profil ferme la session actuelle et ramène à la connexion. Déconnecte-toi après usage sur un appareil partagé. Pour un espace dédié sur ton propre appareil, consulte [Installer l’application](/fr/platform/member/install-as-app).

Si ta session prend fin pendant que Tale est ouvert, par exemple après une déconnexion dans un autre onglet, une requête refusée affiche **Ta session a pris fin. Reconnecte-toi.**, et un téléversement de document échoue avec la même phrase, sans proposer de nouvel essai. Si tu ouvres ensuite l’onglet **Environnement** d’un projet, il affiche plutôt **Accès administrateur requis**. S’il était déjà ouvert, ou si tu le rouvres moins de cinq minutes après son dernier chargement, il affiche encore ses variables, et un enregistrement y affiche la même phrase. **Paramètres > Résidence des données** indique **Tu n'es pas autorisé à gérer la résidence des données de cette organisation.** Dans les pages de ton organisation, dont l’adresse commence par `/dashboard`, Tale vérifie la session et demande confirmation avant d’ouvrir la page de connexion. Cette étape te fait quitter la page actuelle. Les modifications non enregistrées risquent d’être perdues. Choisis **Rester ici** pour garder la page ouverte et copier le travail que tu souhaites conserver. Les refus suivants ne rouvrent pas la confirmation. Sur les autres pages, Tale ne demande rien : recharge la page pour te reconnecter.

Quand tu es prêt, ferme les boîtes de dialogue ouvertes et choisis **Se reconnecter** dans l’avis qui reste affiché en haut de la page, au-dessus de son en-tête, puis confirme. Tale vérifie à nouveau la session avant de quitter la page. Si tu t’es déjà reconnecté dans un autre onglet, ta page reste ouverte. Sinon, la page de connexion affiche le même avis de fin de session. Une fois connecté, tu reviens sur la page où tu étais. Tu peux y remettre le travail copié, mais les brouillons non enregistrés ne sont pas restaurés automatiquement.

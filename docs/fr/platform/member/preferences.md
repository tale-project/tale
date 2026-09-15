---
title: Gérer ton compte et tes préférences
description: Modifie ton nom, protège ta connexion, choisis une langue et comprends les réglages personnels de Tale.
---

Les réglages du compte déterminent le nom visible par tes collègues et ta façon de te connecter. Le menu de profil permet aussi de changer d’organisation, d’équipe et de langue. Ces commandes sont accessibles sans rôle d’admin.

## Modifier le nom visible par tes collègues

Ouvre **Paramètres > Compte**. Sous **Profil**, modifie **Nom**, puis clique sur **Enregistrer** en haut de la page. La commande d’abandon restaure la valeur enregistrée. L’adresse e-mail reste en lecture seule, car elle identifie le compte utilisé pour la connexion et les notifications.

Ton nom est visible par les collègues. Ce n’est pas une instruction privée destinée à l’assistant.

## Protéger la connexion

La section **Sécurité** propose **Changer le mot de passe**, ou **Définir le mot de passe** si ton compte n’en possède pas encore. Respecte les exigences affichées dans le dialogue. Changer le mot de passe ferme tes sessions : garde le nouveau à portée de main avant de confirmer.

Configure une application sous **Authentification à deux facteurs** ou ajoute une passkey dans la section correspondante. Conserve les codes de secours dans un endroit accessible sans connexion à Tale. [Authentification à deux facteurs](/fr/platform/admin/two-factor-authentication) couvre la configuration, la récupération et les exigences de l’organisation.

## Changer de langue ou d’espace de travail

Ouvre le menu de profil depuis ton avatar. **Langue** change la langue de l’interface. Si tu appartiens à plusieurs organisations, **Organisation** change d’espace de travail. **Équipe** restreint la vue à une équipe lorsque des équipes sont disponibles.

Vérifie le nom de l’organisation avant de modifier des réglages ou d’ajouter du contenu. Un filtre d’équipe change la vue, sans accorder l’accès aux données d’une autre équipe.

## Comprendre la navigation mémorisée {#navigation-memory}

Tale mémorise la dernière vue consultée dans chaque [section principale](/fr/platform#navigation), séparément pour chaque organisation. Si tu changes d’organisation puis reviens, tu retrouves ses vues précédentes. Chaque onglet du navigateur garde sa propre navigation : tu peux ainsi travailler dans deux projets côte à côte.

Un nouvel onglet peut reprendre les vues récentes du même navigateur. Cette copie commune expire après huit heures sans navigation enregistrée dans l’organisation ; un onglet qui possède déjà une vue mémorisée conserve sa propre copie. Ces données restent dans le navigateur et ne sont pas synchronisées avec un autre appareil. La déconnexion efface la navigation mémorisée dans l’onglet actuel et la copie commune du navigateur. Si le stockage du navigateur est indisponible, les sections ouvrent leur page par défaut.

## Comprendre la page Personnalisation

Ouvre **Paramètres > Personnalisation** pour consulter **Instructions personnalisées** et **Souvenirs**. Les interrupteurs peuvent suivre les valeurs de l’organisation ou enregistrer un choix personnel. Les instructions enregistrées et les listes de souvenirs appartiennent à tes préférences.

<Frame caption="La page Personnalisation contient les instructions personnelles enregistrées et les commandes des souvenirs.">

![La page Personnalisation affiche un éditeur d’instructions personnalisées et une section Souvenirs avec les suggestions en attente et les entrées enregistrées.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

L’assistant de chat actuel n’utilise ni ces instructions personnelles ni les outils de souvenirs dans ses réponses. Enregistrer une préférence ici ne donne donc pas de contexte durable au chat. Écris la contrainte dans ton message ou utilise **Général > Instructions** dans le projet pour un contexte commun à ses chats.

</Note>

Si des souvenirs existent déjà, examine les suggestions en attente et ne garde que les entrées souhaitées. Supprime un souvenir lorsqu’il ne doit plus être conservé. Sa présence dans la liste ne prouve pas qu’un chat l’a consulté.

## Consulter tes limites d’utilisation {#usage-limits}

Ouvre **Paramètres > Utilisation** pour voir ce que tu as déjà utilisé des limites que ton organisation t’applique. Si aucune limite ne te concerne, la page l’indique.

<Frame caption="Paramètres > Utilisation affiche chaque limite qui te concerne, avec son utilisation et sa prochaine réinitialisation.">

![La page Utilisation affiche les limites mensuelles personnelles de tokens, de coût et de requêtes, puis les limites mensuelles partagées de l’organisation, chacune avec une barre d’utilisation et sa date de réinitialisation. En dessous figure le stockage utilisé par rapport à la limite par personne. Un admin voit aussi le bouton Gérer les limites.](/images/platform/settings-usage.webp)

</Frame>

- **Tes limites** comptent tes propres chats, sorties vocales et exécutions d’agents. Quand l’une d’elles est atteinte, tu ne peux plus lancer ce type d’activité avant sa réinitialisation.
- **Limites partagées** comptent l’utilisation de toutes les personnes qu’elles couvrent, par exemple une équipe dont tu fais partie ou l’organisation entière. Elles peuvent donc être atteintes avant tes propres limites.
- **Stockage** compare les fichiers que tu as téléversés avec ta limite de stockage. Une fois celle-ci atteinte, les nouveaux téléversements de documents sont refusés.

Chaque limite d’utilisation indique la quantité utilisée, la limite et le moment de sa réinitialisation, dans ton fuseau horaire. Les périodes suivent l’heure UTC : les limites quotidiennes repartent à minuit, les limites hebdomadaires le lundi et les limites mensuelles le premier du mois. Si un admin a défini un seuil d’alerte, la barre passe à l’orange dès que ton utilisation l’atteint. Quand un bandeau au-dessus de la zone de saisie signale une limite, **Voir l'utilisation** ouvre cette page. Les admins voient aussi **Gérer les limites**, qui ouvre **Gouvernance > Politiques et limites**.

## Archiver des chats ou se déconnecter

Sous **Paramètres > Compte**, la section consacrée à tes chats propose des actions groupées d’archivage et de suppression. Lis la confirmation attentivement : une action groupée porte sur ton historique de chats. Utilise le menu d’une conversation si tu souhaites seulement ranger celle-ci.

**Se déconnecter** dans le menu de profil ferme la session actuelle et ramène à la connexion. Déconnecte-toi après usage sur un appareil partagé. Pour un espace dédié sur ton propre appareil, consulte [Installer l’application](/fr/platform/member/install-as-app).

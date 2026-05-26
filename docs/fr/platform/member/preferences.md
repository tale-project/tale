---
title: Préférences
description: Les réglages au niveau membre qui te suivent entre orgs et chats — nom d'affichage et mot de passe sous Compte, thème et langue dans le menu de profil, instructions personnalisées et mémoires sous Personnalisation, et déconnexion.
---

Les préférences sont les molettes qui t'appartiennent plutôt qu'à l'org. Ton nom d'affichage est le nom que voient agents et coéquipiers dans les chats et les approbations. Ta langue et ton thème te suivent entre les appareils. Tes instructions personnalisées et tes mémoires façonnent la manière dont les agents te répondent spécifiquement — séparément de tout ce que l'Administrateur ou l'Éditeur a posé au niveau de l'org. Cette page cartographie où vit chaque levier et ce qu'il change.

La forme est volontairement à deux couches : le menu de profil (partout, à un clic de l'avatar) porte les bascules rapides ; **Paramètres > Compte** et **Paramètres > Personnalisation** portent les champs de compte plus profonds. Tout ici t'appartient — rien ne fuite vers d'autres membres ou d'autres orgs.

## Le menu de profil

Clique ton avatar en haut à droite. Le menu déroulant s'ouvre avec ton nom, ton e-mail et la version de build actuelle. Sous l'en-tête se trouvent quatre contrôles rapides que voit chaque membre quelle que soit sa rôle : le sélecteur de **thème** (Système / Clair / Sombre), le sous-menu de **langue** (English, Deutsch, Français), la ligne **Installer l'app** quand le navigateur peut installer Tale en tant que PWA, et **Se déconnecter**. Le thème et la langue prennent effet immédiatement et persistent par appareil.

Le menu porte aussi un sélecteur d'organisation quand tu appartiens à plus d'une org et un filtre d'équipe quand ton org actuelle a des équipes. Ce ne sont pas des préférences — ils changent ce que Tale t'affiche, pas la manière dont Tale se comporte. Sous le filtre d'équipe, **Paramètres utilisateur** ouvre **Paramètres > Compte**, la page couverte ensuite.

## Compte — nom, e-mail, mot de passe, double authentification

Ouvre **Paramètres > Compte**. Trois sections siègent sur la page : **Profil**, **Sécurité** et **Authentification à deux facteurs**.

La section Profil tient ton **nom d'affichage** et ton **e-mail**. Le nom d'affichage s'édite en ligne ; la modification s'enregistre à la sortie du champ et se propage dans chaque chat et chaque approbation au prochain rendu. L'e-mail est en lecture seule — c'est avec lui que tu t'es connecté, et un changement passe par le support. Il n'y a pas de champ avatar sur la page ; Tale dérive un avatar à partir des initiales de ton nom d'affichage.

La section Sécurité tient un seul bouton : **Changer le mot de passe** si tu t'es inscrit avec e-mail et mot de passe, **Définir le mot de passe** si ton compte est fédéré via SSO et que tu veux ajouter un mot de passe comme repli. Les deux flux imposent la politique de mot de passe de l'org et affichent les règles en direct pendant que tu tapes. La section Deux-facteurs apparie le compte à une app TOTP ou à une clé matérielle et affiche les codes de secours une fois à l'enrôlement.

## Personnalisation — instructions, mémoires, sortie vocale

Ouvre **Paramètres > Personnalisation**. La page conditionne chaque fonctionnalité avec une bascule on/off qui suit la valeur par défaut de l'org jusqu'à ce que tu la remplaces.

**Instructions personnalisées** est un champ texte libre — jusqu'à 4 000 caractères — que chaque agent reçoit comme contexte additionnel spécifiquement pour tes conversations. Utilise-le pour ce que tu dirais sinon en tête de chaque chat : ton rôle, ton style de réponse préféré, les projets sur lesquels tu travailles, les contraintes que l'agent doit respecter. La valeur par défaut de l'org décide si la fonctionnalité est active pour les nouveaux membres ; ta bascule la remplace pour ton propre compte.

**Mémoires** sont de courts faits que l'agent enregistre sur toi entre les chats — un sujet sur lequel tu as posé une question, une préférence que tu as exprimée, un contexte que tu ne voudrais pas répéter. Les mémoires enregistrées apparaissent dans une liste avec un bouton supprimer sur chaque ligne ; les mémoires en attente surgissent dans leur propre section avec les contrôles **Approuver** et **Écarter** pour que rien ne se pose dans ton dossier sans que tu le voies. Bascule la fonctionnalité sur off et les mémoires existantes cessent d'être utilisées jusqu'à ce que tu la rallumes.

**Sortie vocale** choisit la voix qu'un agent utilise quand il parle en mode vocal. Le réglage ne s'applique que quand l'org a configuré un fournisseur de voix ; sinon la section explique le manque et pointe vers l'Administrateur.

## Se déconnecter

La ligne **Se déconnecter** en bas du menu de profil confirme via une boîte de dialogue avant de purger la session. Après confirmation, Tale fait un rechargement complet vers la page de connexion pour qu'aucun état périmé ne traîne dans l'onglet. La déconnexion est par appareil — te déconnecter sur ton laptop ne te déconnecte pas sur ton téléphone, et réciproquement.

## Où cela s'inscrit

Les préférences sont la ligne entre toi et le reste de l'org. L'Administrateur de l'org pose les valeurs par défaut — y compris si la personnalisation est active pour les nouveaux membres, quelle est la politique de mot de passe, quels modèles sont autorisés — et tes préférences remplacent les valeurs par défaut là où Tale le permet. La lecture suivante à mettre en file est [Vue d'ensemble Membre](/fr/platform/member/overview) pour la carte du reste de la surface Membre, ou [Installer en tant qu'app](/fr/platform/member/install-as-app) si tu veux que Tale vive dans ton dock plutôt que dans tes onglets de navigateur.

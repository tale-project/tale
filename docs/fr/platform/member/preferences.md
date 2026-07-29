---
title: Préférences
description: Les réglages au niveau membre qui te suivent entre orgs et chats — nom et mot de passe sous Compte, thème et langue dans le menu de profil, tes mémoires, et déconnexion.
---

Les préférences sont les molettes qui t’appartiennent plutôt qu’à l’org. Ton nom est ce que voient agents et coéquipiers dans les chats et les approbations. Ta langue et ton thème te suivent entre les appareils. Tes mémoires sont des faits qu’un agent a proposés à ton sujet et que tu as validés, tenus à l’écart de tout ce que l’Administrateur ou l’Éditeur a posé au niveau de l’org. Cette page cartographie où vit chaque levier et ce qu’il change.

La forme est volontairement à deux couches : le menu de profil (partout, à un clic de l’avatar) porte les bascules rapides ; **Paramètres > Compte** et **Paramètres > Personnalisation** portent les champs de compte plus profonds. Tout ici t’appartient — rien ne fuite vers d’autres membres ou d’autres orgs.

## Le menu de profil

Clique ton avatar en haut à droite. Le menu déroulant s’ouvre avec ton nom, ton e-mail et la version de build actuelle. Sous l’en-tête se trouvent quatre contrôles rapides que voit chaque membre quelle que soit sa rôle : le sélecteur de **thème** (Système / Clair / Sombre), le sous-menu de **langue** (English, Deutsch, Français), la ligne **Installer l'app** quand le navigateur peut installer Tale en tant que PWA, et **Se déconnecter**. Le thème et la langue prennent effet immédiatement et persistent par appareil.

Le menu porte aussi un sélecteur d’organisation quand tu appartiens à plus d’une org et un filtre d’équipe quand ton org actuelle a des équipes. Ce ne sont pas des préférences — ils changent ce que Tale t’affiche, pas la manière dont Tale se comporte. Sous le filtre d’équipe, **Paramètres utilisateur** ouvre **Paramètres > Compte**, la page couverte ensuite.

## Compte — nom, e-mail, mot de passe, double authentification

Ouvre **Paramètres > Compte**. Trois sections siègent sur la page : **Profil**, **Sécurité** et **Authentification à deux facteurs**.

La section Profil affiche d’abord ton **e-mail**, puis ton **nom** — l’e-mail suggère le nom que Tale propose, que tu peux modifier librement. Le nom s’édite en ligne ; la modification s’enregistre et se propage dans chaque chat et chaque approbation au prochain rendu. L’e-mail est en lecture seule — c’est avec lui que tu t’es connecté, et un changement passe par le support. Il n’y a pas de champ avatar sur la page ; Tale dérive un avatar à partir des initiales de ton nom.

La section Sécurité tient un seul bouton : **Changer le mot de passe** si tu t’es inscrit avec e-mail et mot de passe, **Définir le mot de passe** si ton compte est fédéré via SSO et que tu veux ajouter un mot de passe comme repli. Les deux flux imposent la politique de mot de passe de l’org et affichent les règles en direct pendant que tu tapes, et un mot de passe actuel erroné est signalé directement sur le champ plutôt que comme une erreur passagère. Changer ton mot de passe te déconnecte de tous les appareils — le dialogue t’avertit avant que tu confirmes, et tu te reconnectes ensuite avec le nouveau mot de passe. La section Deux-facteurs apparie le compte à une app TOTP ou à une clé matérielle et affiche les codes de secours une fois à l’enrôlement.

## Les mémoires, et l’accord qui les précède

Une mémoire est un court fait à ton sujet qu’un agent a proposé et que tu as gardé — une préférence que tu as exprimée, une contrainte que tu répètes sans cesse, un contexte qui mérite de voyager d’un chat à l’autre. Les mémoires sont la seule partie de ton compte dans laquelle un agent peut écrire, et c’est précisément pour cela que l’écriture passe par toi d’abord.

En proposer une, c’est un tool que le modèle appelle : aucun processus d’arrière-plan ne lit tes conversations pour cela. L’appel inscrit l’entrée comme **en attente** et pose en même temps une ligne d’audit, parce que proposer un savoir durable sur une personne mérite d’être tracé avant même que quiconque soit d’accord. Une entrée en attente ne fait rien d’elle-même : elle patiente comme suggestion sous **Paramètres > Personnalisation** jusqu’à ce que tu l’enregistres ou l’écartes, et seule une mémoire enregistrée pourra être relue.

<Info>

Rien n’est ajouté à un prompt en ton nom. Une mémoire enregistrée n’atteint une réponse que si le modèle la cherche et que la recherche la renvoie — un modèle ne peut pas se donner un savoir durable sur toi en l’écrivant, et il ne peut pas consulter en douce une suggestion que tu as refusée.

</Info>

Les mémoires enregistrées figurent sur la même page, chacune avec un bouton pour la supprimer. Supprimer une mémoire la retire de ce qu’une recherche peut renvoyer, et c’est tout son effet — aucune seconde copie ne voyage dans un autre prompt.

## Se déconnecter

La ligne **Se déconnecter** en bas du menu de profil confirme via une boîte de dialogue avant de purger la session. Après confirmation, Tale fait un rechargement complet vers la page de connexion pour qu’aucun état périmé ne traîne dans l’onglet. La déconnexion est par appareil — te déconnecter sur ton laptop ne te déconnecte pas sur ton téléphone, et réciproquement.

## Où cela s’inscrit

Les préférences sont la ligne entre toi et le reste de l’org. L’Administrateur de l’org pose les valeurs par défaut — la politique de mot de passe, les modèles autorisés, la gouvernance qui s’applique à un chat — et tes préférences les remplacent là où Tale le permet. Une page personnelle se tient à l’écart de cet ensemble : [Variables d’environnement et secrets](/fr/platform/member/environment) porte des variables et des identifiants cantonnés à toi au sein d’une seule organisation plutôt qu’ils ne te suivent d’une org à l’autre — l’endroit où garder la clé de fournisseur qu’utilise un agent BYO. La lecture suivante à mettre en file est [Vue d’ensemble Membre](/fr/platform/member/overview) pour la carte du reste de la surface Membre, ou [Installer en tant qu’app](/fr/platform/member/install-as-app) si tu veux que Tale vive dans ton dock plutôt que dans tes onglets de navigateur.

---
title: Installer en tant qu'app
description: Comment installer Tale en tant que Progressive Web App sur ordinateur et mobile — le raccourci de menu dans les navigateurs Chromium, le chemin iOS Safari, et ce qui change une fois l'app installée.
---

Tale est livré comme Progressive Web App. L'installer pose une icône dans ton dock ou sur ton écran d'accueil, lance Tale dans sa propre fenêtre sans l'habillage du navigateur, et garde la même session que tu avais dans le navigateur. Il n'y a pas de build natif séparé à télécharger et pas d'extension à installer — la même URL avec laquelle tu te connectes est la même app, dans une coque autonome.

Cette page couvre les trois endroits où tu déclenches l'installation : la ligne **Installer l'app** dans ton menu de profil sur les navigateurs Chromium, l'étape de la feuille de partage sur iOS Safari, et la bannière d'installation qu'Android Chrome affiche de lui-même. Une fois installé, Tale se comporte de manière identique ; l'installation ne change que l'habillage autour.

## Le raccourci du menu de profil

Sur Chrome, Edge, Brave, Arc et les autres navigateurs Chromium, le menu déroulant de profil de Tale porte une ligne **Installer l'app** quand le navigateur est prêt à installer. Ouvre le menu depuis ton avatar en haut à droite, fais défiler après le sélecteur de thème et le sélecteur de langue, et clique **Installer l'app**. Le navigateur ouvre sa confirmation d'installation native ; accepte-la, et Tale atterrit dans ton dock (macOS), ta barre des tâches (Windows) ou ta liste d'apps (ChromeOS) en une seconde ou deux.

La ligne n'est là que quand le navigateur a tiré son événement `beforeinstallprompt` et que l'app n'est pas déjà installée. Les navigateurs qui ne tirent pas cet événement — Firefox, Safari, tout en fenêtre privée — n'affichent pas la ligne, donc le menu reste plus court d'un élément plutôt que de promettre ce qu'il ne peut pas livrer.

## iOS et iPadOS

iOS Safari ne tire pas `beforeinstallprompt`, donc la ligne **Installer l'app** n'apparaît pas dans le menu. Le chemin d'installation vit dans la feuille de partage de Safari à la place.

Ouvre Tale dans Safari, tape l'icône de partage dans la barre d'outils, fais défiler jusqu'à **Sur l'écran d'accueil**, et confirme. Tale apparaît sur ton écran d'accueil avec la même icône que la favicon du navigateur. Tape dessus, et Tale s'ouvre dans sa propre fenêtre — pas de barre d'adresse Safari, pas de barre d'onglets, pas de bouton retour au-delà de ce que Tale lui-même expose. Les notifications fonctionnent de la même manière que dans l'onglet du navigateur ; l'installation est la seule différence.

Les autres navigateurs iOS — Chrome, Edge, Firefox sur iOS — sont Safari sous le capot. Ils n'ont pas leur propre entrée Sur-l'écran-d'accueil. Le chemin Safari est le seul chemin d'installation iOS qui produit une vraie app autonome.

## Android

Android Chrome gère l'installation à deux endroits. Le premier est la même ligne **Installer l'app** dans le menu de profil de Tale, identique au flux desktop. Le second est la bannière d'installation propre à Chrome — une barre d'une ligne qui glisse depuis le bas de la page sur les sites qu'il considère installables. Tape **Installer** sur la bannière, confirme dans la feuille système, et Tale atterrit sur ton écran d'accueil.

Si tu as écarté la bannière une fois, elle ne revient généralement pas avant un moment. Le raccourci du menu de profil continue à fonctionner que la bannière ait été affichée ou non. Les autres navigateurs Android — Firefox, Samsung Internet, Brave — ont chacun leur propre chemin d'installation dans le menu du navigateur, généralement étiqueté **Installer l'app** ou **Sur l'écran d'accueil**.

## Après l'installation

Tale tournant dans une fenêtre PWA est le même Tale tournant dans un onglet de navigateur. La session, les chats, la base de connaissances, les agents — tout cela est la même surface. Les différences sont cosmétiques et petites : pas d'habillage navigateur autour de la fenêtre de l'app, une icône dans ton lanceur, et sur la plupart des plateformes la fenêtre se rappelle de sa taille et de sa position entre les lancements.

La désinstallation suit la convention de la plateforme. Sur macOS, glisse l'icône hors du dock ; sur Windows, clic droit et désinstaller ; sur iOS et Android, appui long sur l'icône et retirer. La désinstallation efface la coque PWA mais pas la session — reconnecte-toi via le navigateur, et tes données sont là où tu les as laissées.

## Quand y recourir

L'installation vaut le coup dès que tu te retrouves à ouvrir Tale chaque jour et que tu veux qu'il se sente comme une de tes apps plutôt que comme un de tes onglets. C'est aussi le bon mouvement quand tu veux la fenêtre de chat épinglée sur un bureau virtuel ou une fente Stage Manager que les onglets de navigateur ne respecteraient pas. Saute l'installation si tu te connectes depuis beaucoup de machines et préfères l'onglet du navigateur — Tale marche pareil dans les deux cas. La lecture voisine est [Vue d'ensemble Membre](/fr/platform/member/overview) — c'est la carte de ce que couvre le reste de la surface Membre une fois Tale posé dans ton dock.

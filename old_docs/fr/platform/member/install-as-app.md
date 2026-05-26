---
title: Installer Tale comme application
description: Installe Tale sur ton téléphone ou ton ordinateur portable comme une Progressive Web App. La version installée s'ouvre dans sa propre fenêtre, apparaît sur l'écran d'accueil ou dans le Dock et c'est la façon recommandée d'utiliser Tale sur mobile.
---

Tale est une Progressive Web App, ce qui veut dire que ton navigateur peut l'installer comme application autonome. La version installée s'ouvre dans sa propre fenêtre sans barre d'adresse, vit sur ton écran d'accueil ou dans le Dock, et sur mobile, elle est indiscernable d'une application native — la même barre d'onglets en bas, les mêmes marges respectant les zones sécurisées, les mêmes gestes. Il n'y a rien à télécharger depuis un app store ; l'installation est un simple geste ou clic dans le navigateur où tu te connectes déjà à Tale.

Cette page t'explique comment installer Tale sur iOS, Android et le bureau. Les capacités de la version installée sont identiques sur chaque plateforme : tu restes connecté, toutes les fonctionnalités fonctionnent, et Tale t'informe avec un petit toast dans l'application quand une nouvelle version est prête. L'accès hors ligne est volontairement limité — la plateforme a besoin d'une connexion active au backend, donc Tale affiche un écran hors ligne clair quand tu perds le réseau et reprend automatiquement dès que tu es à nouveau en ligne.

## Installer sur iPhone ou iPad

Ouvre `app.tale.dev` (ou ton URL auto-hébergée) dans Safari — Apple ne laisse pas d'autres navigateurs iOS installer des applications web. Appuie sur le bouton **Partager** dans la barre d'outils, puis fais défiler vers le bas et appuie sur **Sur l'écran d'accueil**. Confirme le nom et appuie sur **Ajouter**. L'icône Tale apparaît sur ton écran d'accueil, et appuyer dessus lance Tale dans une fenêtre autonome sans la barre d'URL de Safari. La barre d'état respecte ton thème : claire quand le système est en mode clair, sombre sinon.

Tu restes connecté entre les lancements. Pour supprimer l'application, appuie longuement sur l'icône et choisis **Supprimer l'app**, comme tu le ferais pour n'importe quelle application native — ton compte reste intact.

## Installer sur Android

Dans Chrome, Edge ou tout navigateur basé sur Chromium, ouvre Tale et cherche l'invite d'installation qui apparaît dans la barre d'URL ou dans le menu de débordement (l'icône à trois points). Choisis **Installer l'application** ou **Ajouter à l'écran d'accueil**. Tale s'installe comme une entrée d'application séparée, accessible depuis le lanceur et la liste des récents. Les notifications ne sont pas utilisées aujourd'hui ; l'application fonctionnera entièrement comme une expérience au premier plan.

Pour désinstaller, appuie longuement sur l'icône Tale et choisis **Désinstaller**, ou supprime l'application depuis les paramètres système.

## Installer sur le bureau

Dans Chrome, Edge, Brave ou Arc, ouvre Tale et clique sur l'icône d'installation à droite de la barre d'URL (un petit moniteur avec une flèche vers le bas). Le navigateur demande une confirmation ; clique sur **Installer**. Tale s'ouvre dans une fenêtre dédiée sans interface du navigateur et apparaît dans le Dock (macOS), la barre des tâches (Windows) ou les activités (Linux).

Firefox n'installe pas les applications web comme fenêtres séparées pour l'instant, mais Tale fonctionne intégralement dans un onglet Firefox normal. Safari sur macOS prend en charge l'installation depuis le menu **Fichier** (**Fichier → Ajouter au Dock** dans les versions récentes).

## Ce que "installé" t'apporte

L'application installée se charge plus vite qu'un onglet vierge car la coque hors ligne et les assets de marque sont mis en cache localement par le service worker. Tale appelle quand même le backend pour chaque opération — il n'y a pas de stockage de données local — donc une connexion active est requise pour toute interaction utile. Les avantages sont d'ordre présentation, pas d'autonomie hors ligne :

- Une fenêtre et une icône dédiées, sans l'interface du navigateur qui gêne.
- Des layouts mobiles avec une barre d'onglets en bas conforme aux conventions de la plateforme.
- Des marges respectant la zone sécurisée pour que le contenu ne glisse pas sous le notch iOS ou la barre de gestes Android.
- Un petit toast quand une nouvelle version de Tale est prête, avec un seul geste pour recharger.

Quand la connexion tombe, Tale affiche une superposition dans l'app qui explique que la plateforme a besoin d'Internet et se reconnecte automatiquement dès que tu retrouves du signal. Si tu lances l'app sans connexion du tout, tu vois l'écran hors ligne autonome — toujours aucune fonctionnalité, mais un message plus clair qu'une page cassée.

## Mises à jour et désinstallation

Les mises à jour sont déployées en continu. Quand Tale publie une nouvelle version, l'app en cours la récupère en arrière-plan ; la prochaine interaction déclenche un toast proposant la mise à jour. Appuyer sur **Mettre à jour** recharge l'app sur la nouvelle version sans réinstallation complète. Si tu ignores le toast, la nouvelle version s'applique la prochaine fois que tu fermes et ouvres complètement Tale.

Pour désinstaller sur n'importe quelle plateforme, supprime l'icône ou l'entrée d'app de la même façon que pour toute autre application. Réinstaller plus tard restaure tout, car toutes tes données sont côté serveur — rien dans l'installation n'est lié à un appareil spécifique.

Installer Tale est l'un des changements les plus simples que tu puisses faire à ton flux de travail quotidien. L'expérience mobile s'améliore considérablement une fois la barre d'adresse partie, l'expérience desktop a un onglet de moins à perdre, et le chemin de mise à jour est intégré. Si tu passes plus de quelques minutes par jour dans Tale, installe-le une fois et oublie l'URL.

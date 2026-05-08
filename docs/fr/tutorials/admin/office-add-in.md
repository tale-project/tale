---
title: Add-in Word & Excel
description: Faire transiter un panneau IA dans Word et Excel par ton instance Tale, avec Office Agents.
---

Microsoft Word et Excel n’ont pas de moyen intégré de brancher ton propre endpoint LLM — la plupart des add-ins IA d’Office sont attachés au cloud de leur éditeur. [Office Agents](https://github.com/hewliyang/office-agents) est un add-in sous licence MIT qui expose un panneau chat IA dans Word, Excel et PowerPoint, et qui accepte n’importe quel endpoint OpenAI-compatible comme modèle backend. C’est aujourd’hui le meilleur fit pour Tale : les utilisateurs travaillent dans leur document, le panneau appelle un agent Tale, chaque requête atterrit dans tes propres journaux.

Office Agents est explicitement **non prêt pour la production** et **n’est pas publié sur Microsoft AppSource** — l’installation se fait exclusivement par sideload via un serveur de dev local. À traiter aujourd’hui comme un workflow power-user / pilote, pas comme un déploiement un-clic pour toute l’organisation. La section finale décrit le chemin vers un déploiement à plus grande échelle.

## Ce que tu vas construire

Un panneau chat IA sideloadé dans Word et Excel qui fait passer chaque requête par ton instance Tale, vers un agent que tu contrôles. Modèle, périmètre de savoir, ton et piste d’audit vivent tous dans Tale — l’add-in n’est que l’UI côté éditeur.

## Prérequis

- Une instance Tale joignable en HTTPS, avec accès Admin.
- Un [agent](/fr/platform/agents/create) configuré pour le travail d’écriture que tu veux — résumer, réécrire, extraire, rédiger. Un bon calibrage fait la différence entre un add-in utile et un gadget.
- Node.js + git sur le poste qui fera tourner Office Agents.
- Microsoft 365 desktop installé (le sideload Office.js a besoin des clients installés — Office sur le web marche aussi, avec d’autres étapes de sideload).

## Étape 1 — Créer une clé API Tale

Va dans **Paramètres > Clés API** et clique **Créer**. Nomme-la selon le poste ou l’équipe (`office-agents-lab`), copie le token `tale_...` et garde-le sous la main. Voir [Membres et rôles](/fr/platform/admin/members-and-roles) — seuls les Admins et Propriétaires peuvent créer des clés API.

## Étape 2 — Cloner et démarrer Office Agents en local

Suis le README à [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents). La version courte :

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# installe et démarre selon les commandes du README
```

Le dépôt est un monorepo avec un package par hôte Office (Word, Excel, PowerPoint). Démarre le serveur de dev de l’hôte que tu veux — Excel et Word ont leurs propres commandes ; le README fait foi.

## Étape 3 — Sideloader dans Word et Excel

Office Agents se livre comme un add-in serveur de dev que tu enregistres avec le flux de sideload de Microsoft. Les docs Microsoft à jour sont sur [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins). Le flux diffère selon l’OS :

- **Windows :** déposer le manifest dans `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins`.
- **macOS :** placer le manifest dans `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/`.
- **Office sur le web :** uploader le manifest depuis le menu **Accueil > Compléments**.

Après sideload, ouvre Word ou Excel et cherche le bouton Office Agents dans le ruban.

## Étape 4 — Pointer l’add-in sur Tale

Ouvre le panneau Office Agents, puis son dialogue `Settings`, et règle :

| Champ      | Valeur                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `Provider` | **OpenAI-compatible** (ou « Custom » — le label varie)                                              |
| Base URL   | `https://<ton-instance-tale>/api/v1`                                                                |
| API key    | Le token `tale_...` de l’étape 1                                                                    |
| Model      | Un slug d’agent retourné par `GET /api/v1/models` — voir [Référence API](/fr/develop/api-reference) |
| CORS proxy | Activer si Tale est sur une autre origine que l’add-in sideloadé                                    |

Sauvegarde. Le panneau parle maintenant à Tale.

## Étape 5 — Test end-to-end

- **Excel :** ouvrir un tableau avec quelques lignes, sélectionner une plage et taper « Résume ces données en trois points » dans le panneau. L’agent répond avec ton modèle Tale.
- **Word :** ouvrir un document, sélectionner un paragraphe et taper « Réécris pour un public non technique ». Même résultat attendu.
- **Vérifier dans Tale :** ouvrir l’historique des conversations de l’agent et confirmer que la requête apparaît comme un nouveau thread. Thread, modèle utilisé et éventuels appels d’outils sont journalisés comme si l’utilisateur avait chatté depuis l’UI Tale.

## Dépannage

- **401 Unauthorized** — clé API révoquée ou mal saisie ; régénérer dans **Paramètres > Clés API**.
- **404 sur `chat/completions`** — l’URL de base n’a pas le suffixe `/api/v1`.
- **Model not found** — le slug est sensible à la casse et doit correspondre exactement à `GET /api/v1/models`.
- **Erreurs CORS dans la console de l’add-in** — activer le proxy CORS dans les `Settings` d’Office Agents, ou ajouter l’origine de l’add-in aux origines autorisées de ton reverse proxy Tale.
- **Manifest sideload rejeté** — vérifier le XML du manifest contre le [schéma Microsoft](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests) ; le serveur de dev d’Office Agents affiche les erreurs de validation au démarrage.

## Déploiement à l’échelle de l’organisation

Le sideload convient à un pilote mais ne tient pas à l’échelle. Pour une organisation entière, le chemin durable est :

1. Forker Office Agents en interne et publier son manifest via [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) ou Intune, pour que chaque siège l’ait automatiquement.
2. Déployer une politique d’audit au niveau agent dans Tale — toutes les requêtes atterrissent déjà dans l’historique de conversations de l’agent, la gouvernance est centralisée.
3. Suivre l’amont : dès qu’Office Agents atteint la production et arrive sur AppSource, basculer sur le manifest hébergé.

## Alternatives pleinement open source

Si Office Agents ne convient pas, deux add-ins plus étroits suivent le même motif base URL + clé API de l’étape 4 :

- **Excel seul** — [LLMExcel](https://github.com/liminityab/LLMExcel) (MIT).
- **Word seul** — [gptlocalhost](https://gptlocalhost.com) / LocPilot.

La configuration est identique : pointer sur `https://<ton-instance-tale>/api/v1` avec une clé `tale_...` et un slug d’agent en tant que modèle.

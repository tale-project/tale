---
title: Add-in Word & Excel
description: Faire transiter un panneau IA dans Word et Excel par ton instance Tale, avec Office Agents.
---

Microsoft Word et Excel n'ont aucun moyen intégré d'amener ton propre point de terminaison LLM, et la plupart des add-ins IA Office sont verrouillés sur le cloud de leur éditeur. [Office Agents](https://github.com/hewliyang/office-agents) est un add-in sous licence MIT qui expose un panneau IA dans Word, Excel et PowerPoint, et accepte n'importe quel point de terminaison OpenAI-compatible comme backend de modèle. C'est ce qui en fait le meilleur choix actuel pour Tale : les utilisateurs éditent leur document, le panneau appelle un agent Tale, chaque requête atterrit dans tes propres journaux d'exécution.

Le résultat à la fin est un panneau sideloadé dans Word et Excel qui parle à ton instance Tale — le modèle, le périmètre de savoir, le ton et la piste d'audit vivent tous dans Tale ; l'add-in n'est que l'UI côté éditeur. Office Agents n'est explicitement pas de qualité production et n'est pas publié sur AppSource, donc ce tutoriel couvre le chemin pilote ; la section finale nomme la route de déploiement à l'échelle de l'organisation.

## Avant de commencer

Il te faut un accès Admin ou Propriétaire dans Tale (seuls ces rôles peuvent créer des clés API), ainsi qu'un agent déjà configuré pour du travail d'écriture documentaire — résumer, réécrire, extraire, rédiger. Bien régler cet agent fait la différence entre un panneau utile et un gadget ; [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) couvre la configuration.

Sur le poste qui fera tourner Office Agents, il te faut Node.js, `git`, et les applications de bureau Microsoft 365 installées. Le sideloading Office.js a besoin des clients installés — Office sur le web fonctionne aussi mais avec un mécanisme de sideload différent. La personne qui lit cette page est celle qui fait le sideload, typiquement un utilisateur avancé ou un pilote.

## Étape 1 — Créer une clé API Tale

Ouvre **Paramètres > Clés API** et clique sur **Créer**. Nomme la clé d'après le poste ou le groupe pilote (`office-agents-lab`), copie immédiatement le jeton `tale_...` — il n'est affiché qu'une fois — et garde-le pour l'étape 4. Seuls les Admins et Propriétaires peuvent créer des clés API ; voir [Membres et rôles](/fr/platform/admin/members-and-roles).

L'étape a fonctionné quand la liste des clés API montre la nouvelle entrée avec un horodatage de dernière utilisation de « Jamais ».

## Étape 2 — Cloner et lancer Office Agents en local

Office Agents est livré comme un add-in à serveur de dev, pas comme un binaire empaqueté, donc il tourne depuis une copie locale. Suis le README du projet sur [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents) pour les étapes d'installation faisant autorité ; la version courte :

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# suis les commandes d'installation et de démarrage du README pour l'hôte Office voulu
```

Le dépôt est un monorepo avec un paquet par hôte Office (Word, Excel, PowerPoint). Démarre d'abord le serveur de dev pour l'hôte que tu pilotes — les deux ont leurs propres commandes dans le README.

L'étape a fonctionné quand le serveur de dev imprime une ligne « ready » et une URL localhost.

## Étape 3 — Sideloader l'add-in dans Word et Excel

Office Agents s'enregistre via le flux de sideload d'add-in de Microsoft. La doc actuelle est sous [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins) ; la disposition des fichiers diffère par OS :

- **Windows** : dépose le manifeste dans `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins`.
- **macOS** : place le manifeste dans `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/`.
- **Office sur le web** : téléverse le manifeste depuis le menu **Add-ins** du ruban **Home**.

Redémarre Word ou Excel une fois le manifeste en place — les applications de bureau scannent le répertoire de sideload au démarrage, pas en cours d'exécution.

L'étape a fonctionné quand le bouton Office Agents apparaît dans le ruban de l'hôte Office que tu as enregistré.

## Étape 4 — Pointer l'add-in sur Tale

Ouvre le panneau Office Agents dans Word ou Excel, ouvre son dialogue **Settings**, et configure :

| Champ       | Valeur                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Fournisseur | **OpenAI-compatible** (l'étiquette varie par release — « Custom » convient aussi)                    |
| URL de base | `https://<ton-instance-tale>/api/v1`                                                                 |
| Clé API     | Le jeton `tale_...` de l'étape 1                                                                     |
| Modèle      | Un ID de modèle renvoyé par `GET /api/v1/models` — voir [API — Référence](/fr/develop/api-reference) |
| Proxy CORS  | Active-le si Tale tourne sur une origine différente de l'add-in sideloadé                            |

Enregistre. Le panneau parle maintenant à Tale.

L'étape a fonctionné quand le dialogue Settings se ferme sans erreur et que la fonction « Test » du panneau ou la première requête renvoie du contenu.

## Étape 5 — Tester end-to-end

Lance une requête dans chaque hôte Office pour confirmer routage et rendu :

- **Excel** : ouvre une feuille avec un petit tableau, sélectionne une plage, demande « Résume ces données en trois points ». L'agent devrait répondre avec le résumé dans le panneau.
- **Word** : ouvre un document, sélectionne un paragraphe, demande « Réécris pour un public non technique ». Même résultat attendu.

Ouvre ensuite l'historique de conversation de l'agent dans Tale et confirme que les deux requêtes apparaissent comme nouveaux fils. Le fil, le modèle utilisé, et tous les appels d'outils sont journalisés exactement comme si l'utilisateur avait chatté depuis l'UI Tale.

L'étape a fonctionné quand les deux requêtes Office produisent une réponse et que les deux fils apparaissent dans l'historique de l'agent.

## Limite de confiance

Ce qui traverse le réseau dans chaque direction :

- **De Word ou Excel vers Tale** : le texte sélectionné, le prompt de l'utilisateur, et toute instruction système ajoutée par Office Agents. Office Agents lit la plage sélectionnée — pas le document entier — et n'envoie que cela.
- **De Tale vers le fournisseur de modèle** : le prompt que l'agent envoie, exactement comme le ferait une requête depuis l'UI de chat. Pour garder ce tronçon dans le réseau, marie ce tutoriel avec [Connecter un fournisseur local](/fr/tutorials/admin/connect-local-provider).
- **De l'hôte Office vers Microsoft** : la télémétrie déjà gouvernée par la politique de ton tenant Microsoft 365 — Tale ne change rien à cela.
- **Clé API en transit** : le jeton `tale_...` se trouve dans le stockage de réglages d'Office Agents sur chaque poste. Révoque la clé (et fais-la tourner sur le poste) dès qu'un portable change de mains.

L'hôte Office ne voit pas le raisonnement du modèle, les appels d'outils, ni les recherches dans la base de connaissances — tout cela reste dans le journal d'exécution de Tale. Le panneau ne voit que la complétion finale.

## Dépannage

- **401 Unauthorized** — la clé API a été révoquée ou mal tapée. Régénère dans **Paramètres > Clés API** et recolle dans les réglages d'Office Agents.
- **404 sur `chat/completions`** — l'URL de base manque le suffixe `/api/v1`.
- **Modèle non trouvé** — l'ID est sensible à la casse et doit correspondre exactement à `GET /api/v1/models`. Recopie depuis la réponse, pas depuis l'étiquette **Fournisseurs IA** de l'UI.
- **Erreurs CORS dans la console de l'add-in** — soit active le proxy CORS dans les réglages d'Office Agents, soit ajoute l'origine de l'add-in à la liste d'origines autorisées de ton reverse proxy Tale.
- **Manifeste de sideload rejeté** — vérifie le manifeste XML contre le [schéma Microsoft](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests) ; le serveur de dev d'Office Agents imprime les erreurs de validation au démarrage.

## Où ça s'inscrit

Le tutoriel de l'add-in Office route le trafic Microsoft 365 vers un agent Tale sans changer le workflow d'édition de l'utilisateur. La même surface API OpenAI-compatible que l'add-in utilise est documentée en détail dans [API — Référence](/fr/develop/api-reference) ; l'agent qu'appelle l'add-in se construit via [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) ; la piste d'audit par conversation vit dans l'historique de chat sous [Conversations](/fr/platform/workspace/conversations).

Pour un déploiement à l'échelle de l'organisation au-delà du pilote, le chemin durable est de forker Office Agents en interne et de publier son manifeste via [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) ou Intune pour que chaque siège reçoive l'add-in automatiquement — le sideloading convient pour un pilote mais ne passe pas à l'échelle. Deux alternatives plus étroites — [LLMExcel](https://github.com/liminityab/LLMExcel) (Excel uniquement) et [gptlocalhost](https://gptlocalhost.com) (Word uniquement) — suivent le même schéma URL de base + clé API si Office Agents ne convient pas.

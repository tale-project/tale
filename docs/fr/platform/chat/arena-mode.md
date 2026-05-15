---
title: Mode Arène
description: Compare deux modèles IA côte à côte sur le même prompt.
---

Le Mode Arène te laisse envoyer le même message à deux modèles IA à la fois et comparer leurs réponses dans une vue divisée. Utilise-le pour évaluer la qualité des modèles, tester un nouveau modèle face à ton modèle actuel ou collecter des données de préférence dans ton équipe.

## Activer le Mode Arène

1. Ouvre une conversation.
2. Clique l’icône **Épées** dans la barre d’outils. L’icône s’allume quand le Mode Arène est actif.
3. Deux menus de modèles apparaissent au-dessus de la saisie, étiquetés **A** et **B** avec **vs** au milieu.
4. Choisis un modèle pour chaque côté. Les menus affichent tous les modèles disponibles pour toi selon les paramètres de gouvernance de ton organisation et les modèles supportés par l’agent actif.
5. Tape un message et envoie.

Pour désactiver le Mode Arène, re-clique l’icône Épées. Tout l’état Arène (sélections de modèle, threads, verdict) est effacé.

> **Note :** Le Mode Arène a besoin d’au moins deux modèles disponibles. Si un seul est configuré, le sélecteur est caché et l’interrupteur désactivé.

## Vue divisée

Après l’envoi, la zone de chat se divise en deux colonnes :

| Colonne    | Contenu                         |
| ---------- | ------------------------------- |
| Gauche (A) | messages du thread du Modèle A. |
| Droite (B) | messages du thread du Modèle B. |

Chaque colonne a un en-tête avec le label et le nom du modèle. Les deux défilent indépendamment et supportent toutes les fonctions du chat, y compris les approbations, pièces jointes et actions sur les messages.

Tu peux continuer à envoyer des messages en Mode Arène. Chaque nouveau message part en parallèle aux deux modèles.

## Enregistrer un verdict

Une fois que les deux modèles ont répondu, une barre de verdict apparaît sous la vue divisée avec quatre options :

| Verdict              | Effet                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| **A est meilleur**   | marque le Modèle A comme préféré.                                       |
| **B est meilleur**   | marque le Modèle B comme préféré et rend le Thread B la branche active. |
| **Égalité**          | marque les deux comme équivalents.                                      |
| **Les deux mauvais** | marque qu’aucune réponse n’est satisfaisante.                           |

Les verdicts sont enregistrés comme feedback avec les métadonnées (choix, ID du Modèle A, ID du Modèle B). Une fois enregistré, les boutons de verdict sont désactivés pour ce tour de comparaison.

## Comment ça marche

Quand tu envoies un message en Mode Arène, la plateforme :

1. crée deux threads séparés (ou réutilise des threads Arène existants) ;
2. copie l’historique de conversation dans les deux threads si c’est le premier message Arène dans une conversation existante ;
3. envoie le même message aux deux modèles en parallèle. Chacun répond dans son thread sans voir la sortie de l’autre ;
4. crée un lien de branche pour que le Thread B soit suivi comme variante du Thread A.

```mermaid
sequenceDiagram
    participant Toi
    participant Plateforme
    participant ThreadA
    participant ThreadB
    participant ModèleA
    participant ModèleB

    Toi->>Plateforme: Envoie un message en Mode Arène
    Plateforme->>ThreadA: Trouve ou crée
    Plateforme->>ThreadB: Trouve ou crée
    alt premier message Arène dans la conversation
        Plateforme->>ThreadA: Copie l'historique précédent
        Plateforme->>ThreadB: Copie l'historique précédent
    end
    Plateforme->>ThreadB: Lie comme branche de ThreadA
    par Inférence parallèle
        Plateforme->>ModèleA: Transmet le message
        ModèleA-->>ThreadA: Réponse
    and
        Plateforme->>ModèleB: Transmet le message
        ModèleB-->>ThreadB: Réponse
    end
    Plateforme->>Toi: Affiche les deux réponses côte à côte
```

Cela garde la comparaison équitable — aucun modèle n'est influencé par la réponse de l'autre, et le verdict reflète la réponse que chaque modèle a produite indépendamment.

## Où ça s'inscrit

Le Mode Arène est la surface d'évaluation dans le chat. Utilise les verdicts qu'il enregistre pour décider quel modèle devient le préréglage **Standard** sous [Fournisseurs IA](/fr/platform/admin/providers), et quels modèles tu câbles à des agents spécifiques dans [Créer un agent](/fr/platform/agents/create). Le journal des verdicts s'accumule comme retour sous la conversation — ton tableau de bord d'analyse d'usage fait surface les données de préférence agrégées par agent et dans le temps.

---
title: Suivre les avis de sécurité
description: Trouve les avis publiés, évalue les risques pour ton installation et signale une vulnérabilité en privé.
---

Pour examiner une mise à jour de sécurité, consulte les [avis de sécurité GitHub de Tale](https://github.com/tale-project/tale/security/advisories) et les [notes de version](https://github.com/tale-project/tale/releases) de la cible. La [politique de sécurité](https://github.com/tale-project/tale/security/policy) du dépôt définit le signalement et les versions prises en charge.

## Évaluer un avis

Commence par les versions affectées et corrigées. Compare-les au runtime en cours d’exécution et aux composants activés, pas seulement à la CLI installée sur ton ordinateur.

| Information | Ce qu’il faut déterminer |
| --- | --- |
| Versions et composants affectés | Si le code vulnérable est présent dans ton installation. |
| Conditions et conséquences | Si ta configuration expose le chemin vulnérable et quels accès il pourrait permettre. |
| Versions corrigées | Quelle version contient le correctif. |
| Gravité et éventuel vecteur CVSS | Les conséquences et hypothèses de l’évaluation, à compléter avec ta propre exposition. |
| Solutions de contournement | Les restrictions temporaires possibles si tu ne peux pas déployer le correctif immédiatement. |
| Identifiant et références | Le document stable à conserver dans les comptes rendus d’incident et de déploiement. |

Un réseau privé ne suffit pas à garantir que l’installation est à l’abri. L’authentification, le comportement des connecteurs et les accès internes peuvent rester pertinents. Détermine la priorité à partir de l’avis et de ta procédure d’incident.

## Appliquer et vérifier le correctif

Tale est un projet 0.x mis à jour en continu. Les correctifs de sécurité paraissent uniquement dans la dernière version, sans rétroportage vers les anciennes. Lis les notes de toutes les versions intermédiaires, puis suis [Mises à jour](/fr/self-hosted/operate/upgrades), avec la préparation des sauvegardes et de la restauration.

Note le correctif installé et vérifie le comportement concerné après le déploiement. Si tu avais appliqué une protection temporaire, retire-la seulement lorsque le runtime corrigé est en service et que tes vérifications réussissent.

## Signaler une vulnérabilité en privé

Ouvre l’onglet **Security** du dépôt et choisis **Report a vulnerability**. Si tu ne peux pas utiliser GitHub, écris à `security@tale.dev`. Ne révèle pas une vulnérabilité non corrigée dans une issue publique.

Indique le composant et la version, les étapes de reproduction et les conséquences probables. Fournis un exemple minimal sans identifiants, données personnelles ni données de production inutiles. Tu peux demander à être crédité dans l’avis publié.

La politique de sécurité prévoit un accusé de réception et une première évaluation sous 72 heures, un correctif ou une solution de contournement partagé en privé avec le rapporteur sous 14 jours, puis un avis GitHub publié avec la version corrigée. Coordonne l’enquête dans le signalement privé.

## Organiser un suivi régulier

Ajoute les pages des avis et des versions à tes favoris et à ta revue régulière des mises à jour. Précise qui les consulte, quelles installations sont couvertes et à qui transmettre les urgences. L’[examen des versions](/fr/self-hosted/operate/release-notes/format) donne la procédure générale ; le [renforcement de la sécurité](/fr/self-hosted/operate/security/hardening) décrit les protections à maintenir entre les mises à jour.

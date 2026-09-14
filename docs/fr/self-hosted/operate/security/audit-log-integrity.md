---
title: Examiner l’intégrité du journal d’audit
description: Vérifie la chaîne d’audit, comprends les limites du contrôle et conserve les preuves en cas d’échec.
---

Suis cette procédure si **Intégrité de la chaîne** signale une rupture ou si tu reçois une notification d’intégrité. Le parcours dans les paramètres nécessite un compte Admin ou Owner. Fais intervenir l’opérateur de ton installation pour examiner la base de données.

## Identifier la plage vérifiée

1. Ouvre **Paramètres > Gouvernance > Journaux** et repère **Intégrité de la chaîne**.
2. Note l’état et la date du dernier contrôle automatique. **Pas encore vérifié** signifie qu’aucun résultat planifié n’est disponible ; ce n’est pas une vérification réussie.
3. Choisis **Vérifier maintenant**. Le résultat indique le nombre d’entrées contrôlées. Un appel vérifie au plus 1 000 entrées depuis le début de la chaîne encore conservée.
4. Si le résultat est partiel, demande à l’opérateur de vérifier la suite. Un nouveau clic repart du même début, sans avancer dans la chaîne. Une première page valide ne prouve pas l’intégrité de tout l’historique.

Le résultat à la demande et l’état du contrôle planifié sont distincts. **Vérifier maintenant** ne modifie pas la date du dernier contrôle automatique.

## Comprendre ce qui est vérifié

Le backend PostgreSQL actuel vérifie le hachage SHA-256 de chaque entrée conservée dont le contenu n’a pas été effacé, ainsi que les liens entre les entrées. La première ligne restante fournit le lien de départ. Cela permet de détecter de nombreuses modifications dans la chaîne conservée, sans constituer un historique complet signé de façon indépendante.

La politique de conservation peut supprimer le début de la chaîne. Le contrôle planifié reprend sa progression enregistrée. Si la conservation a supprimé son ancien point de départ, il repart du premier lien restant. La disparition d’un point de départ encore compris dans la période de conservation n’est pas acceptée de cette manière.

Pour les lignes dont les données personnelles ont été effacées, le vérificateur contrôle les liens sans recalculer le hachage du contenu supprimé. Il compte aussi les lignes effacées sans demande d’effacement correspondante. Examine cet avertissement à partir des demandes d’effacement. Le backend actuel ne vérifie pas de points de contrôle signés par HMAC ; une clé de signature d’audit ne corrige pas ces résultats.

<Warning title="Conserver des preuves indépendantes">
Une chaîne de hachage n’empêche pas de modifier la base et ne prouve pas que chaque action a été enregistrée. Protège l’accès à la base et conserve les preuves indépendantes nécessaires à ton enquête. Ce contrôle seul ne suffit pas à établir qu’une chaîne entière a été réécrite.
</Warning>

## Conserver les détails d’un échec

Un hachage ou un lien incorrect affiche **Intégrité de la chaîne rompue**, l’**ID de l’entrée**, la date, le **Hachage attendu** et le **Hachage stocké**. Utilise **Ouvrir cette entrée** pour examiner l’événement.

1. Enregistre le résultat avec l’organisation, l’ID de l’entrée, l’heure et la version déployée. Conserve les valeurs à l’identique.
2. Préserve les snapshots de base et les journaux utiles de déploiement, d’accès et de sauvegarde avant toute réparation. Restreins l’accès aux copies contenant des données personnelles.
3. Compare l’heure avec les opérations de conservation, d’effacement, de restauration et de maintenance. Une coïncidence temporelle est une piste, pas la preuve que le problème est bénin.
4. Applique ta procédure de gestion des incidents si l’écart reste inexpliqué. Ne modifie pas et ne supprime pas la ligne signalée pour faire réussir le contrôle.

Le guide des [journaux d’audit](/fr/platform/admin/governance/audit-logs) explique les champs et les exports. Un export filtré et plafonné n’est ni une sauvegarde complète ni nécessairement une chaîne complète.

## Suivre le contrôle planifié

Une tâche quotidienne vérifie progressivement les organisations qui possèdent des entrées d’audit. Une rupture de hachage détectée active un incident d’intégrité et envoie une notification de sécurité aux admins de l’organisation. Le même résultat est dédupliqué entre les contrôles ; un résultat différent peut déclencher une nouvelle notification.

Après réparation ou restauration, vérifie que la plage concernée est valide. Un contrôle planifié ultérieur réussi lève l’incident actif. Expliquer l’échec à un collègue ou fermer une notification ne répare pas la chaîne.

Consulte le [renforcement de la sécurité](/fr/self-hosted/operate/security/hardening) pour les protections du déploiement et la [conservation](/fr/self-hosted/configuration/retention) pour les règles qui suppriment les anciennes preuves.

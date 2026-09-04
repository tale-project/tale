---
title: Corbeille
description: La vue de récupération soft-delete pour les enregistrements mis à la corbeille par la rétention — threads de chat, documents, prompts, exécutions de workflow — avant suppression définitive à la fin de la fenêtre de grâce. Les Administrateurs et Propriétaires lisent ceci quand quelqu'un a besoin de récupérer un artefact supprimé.
---

Corbeille est la surface de récupération pour les lignes que la rétention a soft-supprimées sans encore les avoir hard-supprimées. Quand un thread de chat, un document, un modèle de prompt ou une exécution de workflow dépasse sa fenêtre de rétention, il se déplace ici pour la fenêtre de grâce configurée avant que la prochaine passe de nettoyage ne le retire pour de bon. Les Administrateurs et Propriétaires lisent cette page quand un membre redemande un artefact supprimé, quand un workflow a supprimé le mauvais élément, ou quand un audit doit savoir si une ligne est encore récupérable.

## Une restauration mise en pratique

Pour restaurer un thread d'historique de chat, ouvre **Paramètres > Gouvernance > Corbeille** et bascule le filtre **Catégorie** sur **Historique de chat**. Chaque ligne porte le type, le nom, le propriétaire, le statut et le moment de mise à la corbeille. Clique sur **Restaurer** sur la ligne, confirme dans la boîte de dialogue, et la ligne retourne dans sa liste source — les threads de chat réapparaissent dans la boîte de réception des conversations et les documents dans la base de connaissances. Restaurer une ligne expirée par la rétention demande de taper `restore` pour confirmer et est audité comme un dépassement de la politique de rétention.

## Les deux statuts

**Mis à la corbeille** est l'état soft-delete normal. La fenêtre de rétention de la ligne a expiré, elle s'est déplacée à la corbeille, et la fenêtre de grâce tourne encore. Restaurer ramène la ligne dans sa liste source sans dépasser la politique. La fenêtre de rétention repart de zéro au moment de la restauration — un thread de chat, un document ou une conversation externe restaurés comptent à partir de ce moment, et le prochain nettoyage le laisse tranquille au lieu de le faire expirer à nouveau.

**Expiré** est le second état — la fenêtre de grâce s'est écoulée et la ligne est en file pour suppression définitive au prochain nettoyage. Restaurer reste possible mais est un dépassement : la boîte de dialogue te demande de taper `restore` et le journal d'audit enregistre le dépassement avec ton nom.

## Les catégories

La corbeille contient des lignes de nombreuses catégories. Le filtre de catégorie change la vue par onglet :

- Historique de chat (threads)
- Documents
- Fichiers temporaires
- Modèles de prompt
- Retours sur messages
- Contacts
- Conversations externes
- Métadonnées de message
- Exécutions d'automatisation
- Logs de déclencheur d'automatisation
- Registre d'utilisation
- Logs d'audit
- Événements de filtre de chat
- Audit de mémoire

Chaque catégorie respecte sa propre fenêtre de rétention et sa propre fenêtre de grâce — réglées dans la politique de rétention dans [politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Interaction avec la conservation légale

Les lignes sous conservation légale n'apparaissent pas dans la corbeille — le hold les épingle hors de portée de chaque étape de rétention. Quand tu tentes de supprimer une ligne sous hold depuis sa liste source, Tale refuse avec une erreur de conservation légale qui nomme le hold. Lever le hold laisse la rétention faire passer la ligne par la fenêtre de corbeille comme les autres catégories.

## La fenêtre de grâce

La fenêtre de grâce est configurable par catégorie dans la politique de rétention. Une grâce de zéro saute la corbeille entièrement — la passe de nettoyage hard-supprime la ligne immédiatement quand la rétention se déclenche. Une grâce au-dessus de zéro garde la ligne dans la corbeille ce nombre de jours et la fait apparaître ici pendant la fenêtre Administrateur où restaurer reste peu coûteux.

## Où cela s'inscrit

Corbeille est la seconde chance que la rétention donne à chaque catégorie avant que la passe de nettoyage ne retire une ligne pour de bon. Elle s'associe à [politiques et limites](/fr/platform/admin/governance/policies-and-limits) — la page rétention règle les fenêtres ; cette page est la vue de récupération que ces fenêtres alimentent. La page compagnon est [conservation légale](/fr/platform/admin/governance/legal-hold), le seul mécanisme qui bat la rétention avant qu'une ligne n'atterrisse dans la corbeille.

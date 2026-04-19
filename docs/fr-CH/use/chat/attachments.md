---
title: Pièces jointes du chat
description: Attache des fichiers à tes messages pour que l'IA lise images, documents et code.
---

Tu peux joindre des fichiers à n'importe quel message afin que l'agent IA les analyse en même temps que ta question. Les pièces jointes sont traitées avant l'envoi du message et leur contenu est inclus dans la conversation.

## Comment joindre

- Clique l'icône **trombone** dans la barre d'outils du chat et choisis des fichiers.
- Ou glisse-dépose des fichiers directement sur la fenêtre de chat.

Tu peux joindre plusieurs fichiers à la fois. Chaque fichier affiche un indicateur de progression ; le message ne part qu'une fois chaque fichier prêt.

## Types de fichiers pris en charge

| Catégorie     | Extensions                                      | Ce que fait l'IA                                                                  |
| ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| **Images**    | PNG, JPEG, GIF, WebP                            | regarde le contenu visuel — mise en page, graphiques, photos, texte dans l'image. |
| **Documents** | PDF, DOCX, XLSX, PPTX, TXT, Markdown            | lit le contenu textuel, y compris tableaux et titres.                             |
| **Code**      | JS, TS, Python et la plupart des formats source | lit le code source avec conscience syntaxique.                                    |

## Limites de taille et de nombre

- **Taille maximale :** 100 Mo par fichier.
- **Nombre maximal par message :** 10. Pour l'ingestion en masse, utilise la [base de connaissances](/fr-CH/use/workspace/knowledge-base).

## Où vivent les pièces jointes

Les fichiers attachés au chat restent avec la conversation — ils ne sont pas automatiquement ajoutés à la base de connaissances partagée. Si tu veux que l'IA s'en souvienne pour des conversations futures, téléverse-les séparément dans la base.

Supprimer une conversation supprime aussi ses pièces jointes, sauf si la [politique de rétention](/fr-CH/admin/governance) de ton organisation les conserve plus longtemps.

## Sécurité

Les téléversements sont scannés pour virus et types MIME bloqués avant d'atteindre le modèle. Si ton admin a activé la [détection DCP](/fr-CH/admin/governance), les textes extraits des pièces jointes passent par les mêmes règles que les messages saisis.

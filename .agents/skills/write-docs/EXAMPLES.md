# Editing for clarity

These examples illustrate writing decisions, not verified Tale behavior. Product labels, limits,
and example workflows must be checked against the current UI before reuse.

## A short opening can do the job

Weak: “This page explains file uploads. It covers how to upload files.”

Better: “Add reference files to a project so you can use them in its conversations.”

The second version names the action and purpose. Add prerequisites or a distinction from another
kind of upload when readers need them; do not pad the opening to reach a sentence count.

## Give the detail that resolves a decision

Weak: “Configure the access settings, then save your changes.”

Better, if the observed interface supports it: “Choose who should have access before you share
the project. Select individual members for a small working group, or a group when its membership
already matches your team.”

The improvement explains the choice. It still needs verified labels, defaults, and a saving/result
instruction for a complete procedure. Polished language cannot fill those gaps by invention.

## Keep instructions in a readable sequence

Weak: “To open the settings, select Settings. To open the members page, select Members. To invite
a member, select Invite member.”

Better: “Open **Settings > Members**, then select **Invite member**.”

Use the longer form only when separate screens or checkpoints need explanation. The task heading
can already supply the purpose. Add a focused image if locating the invitation control is hard.

## End where the task ends

Weak: “You now know how to manage your files. Files are a core part of your work. Continue your
journey by exploring the many capabilities of the platform.”

Better: end with the verified result, such as “The file appears in the project list.” If a related
task follows, add a link that names it: “To use the file in a conversation, follow the chat guide.”

A descriptive next link does not need a recap paragraph. A long tutorial may benefit from a short
recap of what the reader built; a field reference usually does not.

## Make troubleshooting actionable

Weak: “If the upload fails, check the file and try again.”

Better structure: name the visible symptom, show how to distinguish the supported causes, give
the remedy for each, and tell readers what confirms recovery. For example, an observed file-size
rejection should point to the current limit and explain how to reduce the file or choose another
supported input. Do not invent a limit or recommend clearing state without evidence.

## Use a tip for an optional improvement

Weak: “Tip: Use projects to organize your work.”

Better: “Use a short, specific project name so teammates can distinguish it in the project picker.”

The advice explains a concrete benefit. It may read well as ordinary prose; a Tip component is a
choice, not a reward for adding more content.

---
title: "Why your company AI gets answers wrong with citations"
description: "Trace a wrong AI answer back to its source. Check outdated documents, missing text, and unsupported claims before changing your model or adding files."
slug: enterprise-rag-project-knowledge
topicId: T05
reviewed: 2026-10-03
draft: false
coverAlt: "A selected source passage connects a document library to an open report."
---

A citation gives you somewhere to check an answer. It does not tell you whether the document is current, whether it was ever approved, or whether the answer says what the document says.

When your company AI gives a wrong answer, start with one question and its cited passage. Work back from there: is the source wrong, did search miss the right source, or did the model misread what it found? Each calls for a different fix. Changing the model first can leave the underlying problem untouched.

## A draft can look like an answer

Suppose a colleague asks, “Can we promise weekend support for this launch?” Your knowledge base contains three documents:

- The current support policy says Monday–Friday, with weekends requiring an approved exception.
- A newer launch proposal asks for weekend coverage; approval is still pending.
- A draft announcement says, “We will provide weekend support.”

An answer that quotes the announcement may look well supported. But the draft is repeating the promise you are trying to verify. It cannot authorize that promise.

The useful answer is: **“Standard coverage is Monday–Friday. The supplied proposal still needs approval for weekends. Check the approved exception before promising weekend support.”** That also leaves room for an approval record that exists elsewhere but is missing from this collection.

Before changing a prompt, label the proposal and announcement as drafts and make the effective policy easy to identify. A last-edited date cannot tell the system which document has authority.

## Find where the answer went wrong

Retrieval-augmented generation, usually shortened to RAG, searches your material and gives relevant passages to a model. A document can fail to reach the answer because its text was never indexed, because search missed it, or because the wrong passages were selected. The model can also misinterpret a passage it did receive.

Use this table on the actual bad answer:

| What you find | What to do next |
| --- | --- |
| The cited document is outdated or still a draft | Identify the effective source and clearly mark the old or unapproved version. |
| The right document is uploaded but its text is not searchable | Check extraction and indexing. A scanned PDF may need a readable text version. |
| The right text is searchable but missing from the supplied context | Investigate retrieval and selection with the exact question that failed. |
| The right passage is present, but the answer changes its meaning | Test the model’s interpretation against that passage, including its conditions and exceptions. |
| No supplied source settles the question | Ask the source owner. More fluent wording will not supply the missing decision. |

Keep the question, source revision, cited passage, and answer together. If you can inspect the passages sent to the model, save those too. Visible citations alone do not reveal everything the model saw, so you may not yet be able to distinguish a retrieval problem from an interpretation problem.

This is why checking citations and checking correctness are separate jobs. The [ALCE research benchmark](https://arxiv.org/abs/2305.14627) evaluates both; it does not treat the presence of a citation as proof that an answer is right.

In Tale, storage and indexing are separate states. Check the document’s indexing status before testing its answer. Also note that uploading another file with the same name creates a separate record; it does not replace the old one. See the [Documents guide](https://docs.tale.dev/platform/knowledge/documents).

![Access checks determine which sources may be used. Retrieved passages and their versions must then support the answer. Content updates and permission updates need separate checks.](/blog/diagrams/en/T05-diagram.svg)

## Retest the decision, not just the wording

After fixing the source or retrieval problem, try the original question in a fresh conversation. Then phrase it differently. For the support example, “Is Saturday included?” should follow the same policy as “Can we offer weekend coverage?”

Next, change the evidence: provide an approved weekend exception for this launch. The answer should now change. An assistant that always refuses weekend support has not solved the problem either.

Keep these cases as a small repeatable check. Add questions your colleagues have actually asked, including one the documents cannot answer. Write down the expected answer and its supporting source before running them. This gives you something more useful to compare than whether the next response sounds better.

If the source changes often, test an update too: change a harmless detail, let the normal import and indexing process finish, and ask a new conversation about it. Confirm that the answer uses the new version. An uploaded copy should not be assumed to track its original automatically.

## Check access before adding more documents

When a source is missing, broadening access may seem like a quick fix. First establish whether this person should be allowed to use it.

In Tale, project chat can search that project’s files and accessible organization Knowledge. Organization chat does not search project files. A project agent also needs the relevant tools. Those boundaries are described in the [Knowledge overview](https://docs.tale.dev/platform/knowledge/overview) and [project files guide](https://docs.tale.dev/platform/projects/manage-files).

Test with an ordinary member account, not only an administrator. Check the source title, preview, citation and download as well as the answer. After removing access, test again in a fresh conversation; separately inspect existing conversations and outputs, which may already contain copied information.

You can use the [knowledge-check worksheet](/blog/worksheets/en/T05-knowledge-acceptance.md) to record the failing question, source, repair and retest. Start with one answer your team got wrong. Fixing that traceable failure is more useful than adding another hundred documents without knowing what was missing.

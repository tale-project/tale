---
title: "Enterprise RAG: permissions, freshness, citations"
description: "Evaluate shared AI knowledge with practical checks for document access, source freshness, indexing, and citations before expanding your team pilot."
slug: enterprise-rag-project-knowledge
topicId: T05
reviewed: 2026-10-03
draft: false
coverAlt: "A selected source passage connects a document library to an open report."
---

A shared AI knowledge base should earn permission to answer a defined class of work questions. That is a more useful launch decision than whether its answers sound good. For enterprise retrieval-augmented generation, or RAG, a fluent answer can be well cited and still use a superseded policy, turn a proposal into a promise, or expose a source the requester cannot access.

Our recommendation is to evaluate those failures separately, then decide which questions the collection is ready to support. Improve retrieval when evidence exists but is missing from the answer context. Fix the source or narrow the task when the evidence does not exist. A larger collection cannot approve a decision the organization has not made.

## Separate five questions that a polished answer hides

RAG finds material and supplies it to a model that generates an answer. Between the original source and the final sentence are extraction, indexing, access filtering, selection, and interpretation. An end-to-end score can tell you something went wrong without telling you where to intervene.

| Question | What it establishes | What it cannot establish |
| --- | --- | --- |
| Is the retrieved material relevant? | It concerns the question | It contains enough evidence to answer |
| Is the context sufficient? | The necessary facts are present | Those facts are current or authoritative |
| Is the answer faithful? | Its claims follow from the supplied material | The material describes the organization's actual decision |
| Is the source authoritative and current? | It is the intended basis for this decision | This requester may access it |
| Is access authorized? | The source is permitted in this user's context | Its answer is correct |

This is a diagnostic distinction, not a proposed universal scoring standard. A missing approval is an evidence problem; an approval record omitted from the retrieved passages is a retrieval problem. Both can produce the same unsupported answer, but their remedies differ.

Research supports making the distinction. The *Sufficient Context* study separates whether context can answer a question from whether a model uses it correctly. In its question-answering experiments, retrieval improved overall performance while models often answered incorrectly instead of abstaining; sufficient context also did not eliminate errors. Some answers were correct despite insufficient context, including cases involving model knowledge or ambiguity. Those benchmark results do not establish a failure rate for internal policy questions. [Joren and colleagues, ICLR 2025](https://arxiv.org/html/2411.06037v3).

For internal commitments, a plausible answer from model knowledge is particularly weak evidence. A model may know common support practices; it cannot establish that your launch exception was approved yesterday.

![An access context limits allowed sources, retrieval finds passages, and a reviewer checks whether citations support the draft. Document freshness and permission freshness are separate checks.](/blog/diagrams/en/T05-diagram.svg)

## Work through a launch decision

The following source pack and candidate answers are synthetic. They illustrate how to grade a decision; no Tale run or measured outcome is implied.

A project owner asks: “What support coverage can we promise in the launch announcement?” The collection contains:

| Source | Content and authority | Access |
| --- | --- | --- |
| SRC-01 | Effective 1 October: standard support runs Monday–Friday; weekends require an approved exception | Shared reference |
| SRC-02 | Launch proposal, 2 October: weekend coverage proposed; approval outstanding | Launch project |
| SRC-03 | Draft announcement, 2 October: “We will provide weekend support” | Launch project |
| SRC-05 | Legacy policy, superseded 1 October: standard support includes Saturdays | Shared archive |

The correct work decision is to withhold the weekend promise on this evidence and ask for the exception record. That is narrower than asserting that no approval exists anywhere. The collection establishes an outstanding proposal and contains no later authorization.

Now inspect three constructed answers:

| Candidate answer | Diagnosis | Better next action |
| --- | --- | --- |
| “Weekend support is confirmed,” citing SRC-03 | It repeats draft language but treats a draft as authority | Correct the source hierarchy and flag the unsupported promise |
| “Support includes Saturdays,” citing SRC-05 | The citation supports the words, but the policy is superseded | Make the effective policy discoverable and test revision selection |
| “Weekday support is established. Weekend coverage is proposed; provide the approved exception before promising it,” citing SRC-01 and SRC-02 | Supports the known facts and identifies the missing decision | Assign the exception question to its owner |

A citation-quality check alone would miss part of this problem. The ALCE benchmark evaluates answer correctness and citation quality separately, and found incomplete citation support in tested systems. Its results justify checking support claim by claim; they do not make a citation a guarantee of current policy. [Gao and colleagues: ALCE](https://arxiv.org/abs/2305.14627).

Make the answer inspectable by retaining three small items: the exact question, the passages supplied to generation where observable, and the final claims with their citations. If the product does not expose the full retrieved context, mark retrieval diagnosis as uncertain. The visible citations are not proof of everything the model saw.

## Repair the layer that failed

Suppose the synthetic answer incorrectly promises weekend coverage. Begin with the source record, not a new prompt.

If SRC-01 never indexed because it was an unreadable scan, replace or repair that source and check indexing. If it indexed but was absent from the supplied passages, investigate retrieval or context selection. If both policy and proposal were present but the answer still said “approved,” test how the model handles that explicit conflict. Changing all three layers together may improve one example while leaving you unable to explain why.

After repair, ask the original question in a fresh conversation, then a paraphrase. Add a counterexample: an approved, dated weekend exception for this launch. The expected answer should now change. A system that always refuses weekend coverage has learned the test's wording rather than the decision rule.

Tale distinguishes downloadable files from indexed files. Its [Documents guide](https://docs.tale.dev/platform/knowledge/documents) describes supported formats and the need for readable text in scanned PDFs. A second upload with the same filename creates a separate record. Record source IDs and revisions so an attempted repair does not quietly add another conflicting copy.

## Treat access as a gate, not an average

A strong answer for nine users does not offset a restricted-source disclosure to the tenth. Keep authorization failures separate from quality averages and investigate them before expanding that scope.

Use two ordinary users with different access. Test titles, snippets, citations, downloads, and answers—not just whether the restricted sentence appears verbatim. Repeat after membership changes, using both a fresh conversation and an existing one. Revoking future retrieval cannot erase information previously disclosed in a conversation or copied into an output; those are separate retained artifacts to inspect.

Permission checks also depend on their inputs being current. Microsoft's Azure AI Search documentation describes query-time enforcement against indexed permission metadata and the need to update that metadata when source permissions change. Its native permission mechanisms include preview features and vary by source. The transferable lesson is to measure permission freshness alongside content freshness. [Microsoft: document-level access control](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview).

In Tale, project chat can search that project's files and accessible organization Knowledge; organization chat does not search project files. Project agents need the corresponding equipped tools. Library documents default to organization-wide access and can be restricted to teams, with broader access for Owners and Admins. An imported copy should therefore have its destination audience verified rather than assuming source-system permissions transfer automatically. [Knowledge scope](https://docs.tale.dev/platform/knowledge/overview), [document access](https://docs.tale.dev/platform/knowledge/documents), and [project files](https://docs.tale.dev/platform/projects/manage-files) explain these boundaries.

## Give freshness a business meaning

A current timestamp is not enough. For the launch example, a proposal edited this morning still has less authority than an approved exception from yesterday. Record owner, authority, effective date, and superseded source separately from the last edit time.

Then observe the delay between a source change and an answer using it. Record source-change time, ingestion/index completion, and the first fresh-conversation query that uses the intended revision. AWS notes that query availability can lag ingestion completion for some Bedrock vector stores. A completed job is therefore useful evidence to follow with a query. [Amazon Bedrock synchronization](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-data-source-sync-ingest.html).

Tale distinguishes one-time imports from supported sync imports. Personal OneDrive folders support sync; SharePoint selections import once. Native Google Docs, Sheets, and Slides need export to supported files. Confirm the chosen selection's behavior in the [import guide](https://docs.tale.dev/platform/knowledge/documents). If a time-sensitive decision changes faster than your proven update path, use its authoritative source directly until the new revision is searchable.

## Decide whether retrieval is the right next investment

The strongest argument against this process is that it seems excessive for a small team with six documents. That objection is often right. A short, stable, approved packet that everyone involved can access may be easier to inspect directly than to maintain as a retrieval evaluation project. Still check the answer against the packet; the model can misinterpret complete context too.

The recommendation changes again for exact operational state. “Which order is currently blocked?” may need a current structured record, not an indexed paragraph from yesterday's export. Tale's [Knowledge guide](https://docs.tale.dev/platform/knowledge/overview) distinguishes documents from contacts and products maintained as records. Choose the representation that preserves the fact needed for the decision.

RAG earns its operational cost when people repeatedly need relevant portions of a larger, changing collection and the retrieval path can honor their access. Even then, a conflict that only a source owner can resolve should become an assigned question, not another search iteration.

## Make a bounded rollout decision

Copy the [knowledge acceptance worksheet](/blog/worksheets/en/T05-knowledge-acceptance.md). It contains the synthetic source pack, a completed grading example, a repair path, and cases covering restricted access, stale guidance, absent evidence, and changed conclusions.

Report answer quality on answerable cases separately from appropriate abstention on unanswerable ones. A system that refuses everything should not pass as a useful assistant. Keep failures and inconclusive attempts visible; do not count a case as passed when the access context or source state was never verified.

The resulting decision can be specific: “Use this collection for standard support questions; launch exceptions still need the source owner's confirmation.” That gives teammates useful knowledge now and a clear task for improving it. Bring one such source set and decision to a [Tale demo](/request-demo).

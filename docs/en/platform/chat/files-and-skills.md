---
title: Make files and use skills in chat
description: Ask the assistant for a document, spreadsheet, presentation, chart, or image, and let it follow a skill from your library, without leaving the conversation.
---

The assistant can make what you ask for in the conversation: a CSV or Markdown file it writes itself, a Word document, Excel workbook, PowerPoint presentation, PDF or chart it builds in a light sandbox, and images when your organization allows them. The files appear below the reply, ready to open and download. Skills from your [skill library](/platform/workspace/skills) tell it how to make them well.

## Ask for the file you need

Name the format and the content in your message, as you would to a colleague. For example: “Make an Excel file with our monthly revenue for 2025 and a total row that uses a formula.” Or: “Turn this into a nicely formatted PDF,” followed by the text.

The assistant uses the lightest way that does the job, and starts nothing it does not need:

| You ask for | The assistant | What it starts |
| --- | --- | --- |
| An answer, a comparison table, a short code block | Answers in the reply | Nothing |
| A Markdown, CSV, JSON, HTML or SVG file, a calendar entry (`.ics`) or a contact card (`.vcf`) | Writes the file itself | Nothing |
| A picture: an illustration, a photo-like scene, a logo | Generates an image | Your organization’s image model, when [image generation](/platform/admin/governance/content-models#let-agents-generate-images) is on |
| A Word, Excel, PowerPoint or PDF file, a chart, a calculation over data, a change to a file you attached | Runs code in a light sandbox | A light sandbox, in about a second |
| Work on a repository, in a browser session, or lasting hours | Suggests a [project task](/platform/projects/tasks) | Nothing in the chat; the task’s agent works in its own sandbox |

A file that should be reviewed, kept with other work or made later belongs on a task: the project's [standard agent](/platform/projects/project-agents#standard-agent-runs) uses the same tools there, and the files it makes become the task's deliverables.

While it works, the steps above the reply say what it is doing, such as **Writing contacts.csv**, **Reading the xlsx skill** or **Running Python in a light sandbox**. A failed step says what went wrong on the line under it, such as **All light sandboxes are in use** or **The program ended with an error**, and the assistant usually corrects its code and tries again.

## Open and download the files

The files appear under the reply, in the order they were made. PNG, JPEG, GIF and WebP images show as pictures; select one to open it full size and page through the others. Every other file, SVG files included, shows as a card with its name, type and size, and so does a picture that cannot be displayed. Select the card to preview the file; PDF, Word, spreadsheet, Markdown, text and SVG files open in place. The download button beside the card saves the file under its own name.

<Frame caption="The file the assistant wrote appears as a card under its reply, with a download button beside it.">

![A chat asks for the onboarding feedback themes as a CSV file. The steps show Writing onboarding-feedback-themes.csv, the reply says the file is attached, and a card below it shows onboarding-feedback-themes.csv, CSV, 251 B, with a download button.](/images/platform/chat-reply-files.webp)

</Frame>

When the assistant revises a file in the same reply, for example after checking its own output, the card shows the final version only. Ask for a change in a follow-up message to get a new version in the next reply.

Files belong to the conversation: whoever can open the conversation can open its files.

## Change a file you attach

[Attach the file](/platform/chat/attachments) and say what should change: “Add a chart of the totals to the attached spreadsheet,” or “Convert the attached Word document to PDF.” The assistant copies the file into the light sandbox and returns the result as a new file. The file you attached stays as it was.

A picture you attach can also be the starting point for a new image when your organization allows [image generation](/platform/admin/governance/content-models#let-agents-generate-images). Ask, for example, “Turn the attached photo into a watercolor.” The assistant hands the photo to the image model, and the new image appears below the reply.

## Use a skill

A skill is a tested procedure for a kind of work, such as a document format or a house style. Your skill library holds the skills shared with the whole organization and with your teams; the built-in skills `docx`, `xlsx`, `pptx` and `pdf` cover the Office and PDF formats.

There are three ways to use a skill in a chat:

| How you use it | Which replies read it |
| --- | --- |
| Start a message with `/` and the skill’s name | The reply to that message, before it answers |
| Check it under **Skills** in the model picker | Every reply in the conversation, each before it answers |
| Leave it to the assistant, which reads a skill that fits your request | The reply it reads the skill for |

To use a skill for one message, type `/` at the start of the message box, or choose **Use a skill** in the composer’s **+** menu. The skills you can use appear above the box; type to narrow them, then press Enter or select one. Your message then starts with the skill’s name, such as `/docx Write the cover letter`, and shows it as a chip once sent. The reply reads the skill before it answers: its first step is **Reading the docx skill**.

![A new chat with a slash typed in the message box. Above the box, a list of skills: docx, pdf, pptx, visual-aspect-analyzer and xlsx, each with the start of its description, and docx highlighted.](/images/platform/chat-skill-picker.webp)

To use skills for a whole conversation, open the model picker, go to **Skills** and check up to four. Every reply in that conversation reads them before it answers. A new chat starts without any.

The assistant also reads a skill on its own when one fits your request, or when you name it in your words. It sees the name and description of every skill in your library; in a library of more than 40 skills, it sees the first 40 in alphabetical order, so choose any other one with `/`. A skill whose author marked it for explicit use only is meant for when you choose it: the assistant is asked not to use it otherwise.

A skill can also say how the assistant writes: a tone, a format, a closing line for every reply. The assistant follows a skill throughout the reply that reads it, in how it writes as much as in what it does. A skill the assistant reads on its own is read for that reply; later replies read it again only when the assistant picks it again. To have a skill shape every reply, check it under **Skills**: each reply then reads it in full before it answers.

A skill guides the assistant; it does not change what the assistant is allowed to do, and where it conflicts with the assistant’s other instructions, such as your organization’s, those win. A skill’s scripts and templates run in the light sandbox, like the assistant’s own code; a skill made only of instructions starts no sandbox. When an administrator turns off **Skills** under Chat tools, there is nothing to choose, and a message that starts with `/` is sent as written.

## Know the limits

- A light sandbox belongs to one conversation. It keeps its files between the assistant’s steps and your follow-up messages, and after about five minutes without use it is removed; the next request starts a fresh one. When your organization’s light sandboxes are all in use, an idle one gives way; when none is idle, the assistant tells you to try again in a minute.
- One run of code may take up to three minutes, and the tools of one step may run for at most five minutes together. At most 16 tools run in one step. Press **Stop generating** and a running program is cut off within seconds. A run attaches up to 10 files, each up to 20 MB; when a program writes many more, the reply names a few and counts the rest.
- A file the assistant writes itself holds up to 1 MB of text.
- One request creates up to 4 images, and one reply up to 16. A request can start from up to 4 images of the conversation, or fewer if the image model takes fewer. Images are billed to your organization and count against you, like the reply itself.
- When the tools for making files cannot be set up for a reply, for example because your organization’s Chat tools policy cannot be read, the reply says so under it. Ask again later, or ask an administrator to check the policy.

An administrator decides what chat can make under [Chat tools](/platform/admin/governance/policies-and-limits#chat-tools), whether it can create images under [Image generation](/platform/admin/governance/content-models#let-agents-generate-images), and how many light sandboxes your organization runs at once under [Sandboxes](/platform/admin/sandboxes#light-sandboxes). A tool that is switched off is gone from every chat; the assistant then answers in the reply or suggests a task instead.

Pictures need image generation turned on and an image model that your organization’s provider credentials reach. Without them, when you ask for a photo, an illustration or artwork, the assistant says that image generation is not available and that an Admin or Owner can turn it on under **Settings > Governance > Models**. It does not hand you an SVG as the picture; it still writes SVG files for diagrams, icons and charts.

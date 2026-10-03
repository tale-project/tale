# Front page

> **Prefix** `HOME-` · **Reset** none · **Cost** ~15 min

The component studio at `/` uses the **marketing** design language
(`@tale/marketing-ui`): shared site chrome, a split hero with working controls,
visual package choices, a guide catalog, installation commands, and a closing
link to the introduction. Everything under `/docs` keeps the shared application
documentation frame and has its own suite ([docs.md](docs.md)).

## Scope & routes

| Surface | Route / source |
| --- | --- |
| Front page | `{base}/` |
| Chrome | `app/components/home/site-chrome.tsx` (`SiteHeader`, compact footer) |
| Component studio | `app/components/home/home-showcase.tsx` (local state and shipped controls) |
| Page composition | `app/pages/home-page.tsx` |

## Preconditions

The dev server up per [`../setup.md`](../setup.md), a 1440×900 viewport, the OS
in light mode, `prefers-reduced-motion` **off** unless a box says otherwise.

## Boxes

- [ ] `HOME-1` · **Open `/`** → the header carries the logo, **Docs**, **Components**, **GitHub**, and the theme control; the hero reads **React components. One shared language.** with a short explanation, **Start building** / **Browse components**, and the actual guide count and MIT licence; the component studio sits beside the copy at desktop width.
- [ ] `HOME-11` · **Sight down the left edge of the page** → the logo, hero heading, section headings, and content share the container gutters; the hero wash continues behind the header without a seam.
- [ ] `HOME-2` · **Activate Start building, then the browser Back button** → the link opens `/docs/getting-started/installation` in the documentation frame; Back returns to the studio with marketing chrome and no stale header.
- [ ] `HOME-3` · **Use Component studio** → **Application UI** shows the workspace name, Weekly digest switch, a status badge, and **Reset preview**; editing the name updates the specimen heading, and the switch updates **Digest on** / **Digest off**. **Marketing UI** shows a compact website composition with a working link to its component guide.
- [ ] `HOME-4` · **Switch the theme to Dark, then Light** → both studio panels, package specimens, catalog, and installation panel follow the theme with readable text and control outlines; the explicit theme survives a reload.
- [ ] `HOME-5` · **Navigate the studio with the keyboard** → the tab strip is one Tab stop; Left/Right switches the selected panel; the input, switch, reset action, and marketing guide link are reachable with visible focus. Edits survive switching panels and **Reset preview** restores the initial name and enabled digest.
- [ ] `HOME-6` · **Activate each of the five rows under Find your next building block.** → Getting started, Foundations, Components, Patterns, and Marketing UI open their first guide (`introduction`, `colors`, `button`, `list-page`, `overview`) in the documentation frame.
- [ ] `HOME-12` · **Read the guide catalog without activating it** → each row carries a short description and the guide count from its section in the documentation rail; labels, counts, and arrows stay legible without colliding at narrow widths.
- [ ] `HOME-7` · **Select each installation tab and copy its command** → the clipboard holds the exact visible command; the app command installs `github:tale-project/tale#dist/ui`, and the marketing command includes both `dist/ui` and `dist/marketing-ui`. Both include React 19 and Tailwind CSS 4. The nearby note explains the remaining setup, and **Read the installation guide** opens `/docs/getting-started/installation`.
- [ ] `HOME-8` · **Reload with reduced motion enabled** → all content is readable immediately with no entrance movement; the studio controls still work. With normal motion, section entrances occur once without moving the surrounding layout.
- [ ] `HOME-9` · **Resize to 393 px and open navigation** → the header collapses to the logo and **Open navigation menu**; the menu lists Docs, Components, and GitHub, plus three inline theme choices (44 px on touch, compact with a mouse); the hero and studio stack without horizontal page scrolling.
- [ ] `HOME-10` · **Read the footer** → it names the current year, Ruler GmbH, and the MIT licence; **llms.txt** opens the plain-text index and **GitHub** opens the repository. There is no language switcher pointing to absent translated routes.
- [ ] `HOME-13` · **Resize through 320, 360, 768, 1024, and 1440 px and rotate a phone** → headings, actions, controls, both studio panels, and package specimens remain readable; long workspace names wrap; code scrolls only within its frame, never the page.
- [ ] `HOME-14` · **Reload the production build with JavaScript disabled** → the initial application specimen, name field, enabled digest state, guide catalog, and app installation command are visible; no entrance leaves the studio blank. Re-enable JavaScript and verify both studio and installation tab strips respond.
- [ ] `HOME-15` · **Read the package choices at phone and desktop widths** → Application interfaces and Public websites have distinct visual specimens and copy, name `@tale/ui` / `@tale/marketing-ui`, and link to the correct guides; keyboard focus remains visible around the complete card in both themes.

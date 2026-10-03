# Documentation discovery

> **Prefix** `HOME-` · **Reset** none · **Cost** 10 minutes

Judge the public discovery page and its transition into the article frame. Automated
coverage owns routing, search shortcuts, locale links, and viewport containment;
this suite judges composition, legibility, focus visibility, and motion.

## Preconditions

Start the site per [setup](../setup.md). Visit `/`, `/de`, and `/fr` in light and dark
modes, with ordinary motion first. No account or platform backend is needed.

> **Agent note**: wait for the single heading from `home.heroTitle`; article pages
> use their frontmatter title and show the documentation rail instead.

## Visual and accessibility checks

- [ ] `HOME-F1` · **Read the homepage at 390 and 1440 px in both themes** → the hero search and task progression are distinct, the first-agent guide is prominent, alternatives remain concise, and tutorial and reference sections have clear hierarchy; text, borders, and focus indicators remain legible without clipped labels.
- [ ] `HOME-A1` · **Tab through the hero, progression, role paths, tutorials, and footer** → every destination has a visible focus indicator; the guide map is real navigation, its order is understandable without motion, and neither icons nor decorative surfaces become extra tab stops.
- [ ] `HOME-P1` · **Reload with reduced motion, then with ordinary motion, and follow a guide before returning home** → reduced motion shows complete content immediately, entrances do not shift surrounding content, revisiting does not hide already-read content, and article pages retain the app palette and shared frame.

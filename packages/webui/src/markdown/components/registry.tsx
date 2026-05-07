import { Accordion, AccordionGroup } from './accordion';
import {
  Callout,
  CheckCallout,
  InfoCallout,
  Note,
  Tip,
  Warning,
} from './callout';
import { Card, CardGroup } from './cards';
import { CodeGroup } from './code-group';
import { Frame } from './frame';
import { Step, Steps } from './steps';
import { Tab, Tabs } from './tabs';

/**
 * Component table passed to react-markdown's `components` prop. The HTML
 * parser used by `rehype-raw` lowercases tag names, so authored Mintlify
 * tags like `<CodeGroup>` reach the map as `codegroup`. Keys here mirror
 * that lowercased form (and aliases keep PascalCase keys around so direct
 * JSX usage in the renderer also works).
 */
export const mintlifyComponents = {
  // Lowercase keys — match the form rehype-raw produces from authored HTML.
  note: Note,
  tip: Tip,
  info: InfoCallout,
  warning: Warning,
  check: CheckCallout,
  callout: Callout,
  card: Card,
  cardgroup: CardGroup,
  frame: Frame,
  steps: Steps,
  step: Step,
  tabs: Tabs,
  tab: Tab,
  codegroup: CodeGroup,
  accordion: Accordion,
  accordiongroup: AccordionGroup,
  // PascalCase aliases — kept so that components can also be referenced by
  // their original Mintlify spelling (e.g. when bypassing rehype-raw).
  Note,
  Tip,
  Info: InfoCallout,
  Warning,
  Check: CheckCallout,
  Callout,
  Card,
  CardGroup,
  Frame,
  Steps,
  Step,
  Tabs,
  Tab,
  CodeGroup,
  Accordion,
  AccordionGroup,
};

export type MintlifyComponents = typeof mintlifyComponents;

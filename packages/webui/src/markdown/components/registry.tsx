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
 * Component table passed to react-markdown's `components` prop (after the
 * markdown source has been preprocessed for JSX) so authored markdown
 * keeps using Mintlify's tag names without rewrites.
 */
export const mintlifyComponents = {
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

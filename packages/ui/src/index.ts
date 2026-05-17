// Subpath exports are the recommended import surface (see exports map in
// package.json). This barrel exists only as a convenience for consumers that
// want a single import.

export { cn } from './lib/cn';

export {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  type FormatCurrencyOptions,
  type FormatNumberOptions,
} from './lib/format';

export {
  Button,
  buttonVariants,
  type ButtonProps,
} from './components/primitives/button';

export { Input, type InputProps } from './components/forms/input';
export { Textarea, type TextareaProps } from './components/forms/textarea';
export { Label } from './components/forms/label';
export { Checkbox } from './components/forms/checkbox';
export { Slider, type SliderProps } from './components/forms/slider';
export { Field, type FieldProps } from './components/forms/field';

export {
  Badge,
  badgeVariants,
  type BadgeProps,
} from './components/feedback/badge';
export {
  Accordion,
  AccordionItem,
  type AccordionProps,
  type AccordionItemProps,
} from './components/feedback/accordion';

export { Container, type ContainerProps } from './components/layout/container';
export { Section, type SectionProps } from './components/layout/section';

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/overlays/tooltip';

export { TaleLogo, type TaleLogoProps } from './logo/tale-logo';

export { ThemeContext, ThemeProvider, useTheme } from './theme/theme-provider';
export type {
  ResolvedTheme,
  Theme,
  ThemeProviderProps,
} from './theme/theme-provider';

import {
  Bot,
  ClipboardList,
  FileText,
  Globe,
  Image as ImageIcon,
  Search,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * The lucide icon for a tool family — used as a step row's leading glyph so the
 * row reads as "what kind of work happened" at a glance. Falls back to a generic
 * wrench for unknown tools.
 */
export function toolIcon(toolName: string): LucideIcon {
  // Delegations to sub-agents ("Asking the Research agent") and external-agent
  // Task/Agent sub-agent launches show an agent icon, not the generic wrench.
  if (
    toolName.startsWith('delegate_') ||
    toolName === 'Task' ||
    toolName === 'Agent'
  ) {
    return Bot;
  }
  if (toolName === 'ExitPlanMode' || toolName === 'EnterPlanMode') {
    return ClipboardList;
  }
  if (toolName === 'web') return Globe;
  if (toolName === 'rag_search') return Search;
  if (toolName === 'image') return ImageIcon;
  if (
    toolName === 'pdf' ||
    toolName === 'docx' ||
    toolName === 'pptx' ||
    toolName === 'excel'
  ) {
    return FileText;
  }
  return Wrench;
}

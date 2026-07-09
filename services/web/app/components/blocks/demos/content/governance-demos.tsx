import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ChatArena } from '@/app/components/blocks/demos/chat-arena';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useArenaScenario,
  useAutomationScenario,
  useGovernScenario,
  useKnowledgeScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';

export function GovernanceHeroDemo() {
  const scenario = useGovernScenario('platformGovernance');
  return <GovernGate scenario={scenario} />;
}

export function GovernanceTourAutomationsDemo() {
  const scenario = useAutomationScenario('platformGovernance');
  return <AutomationRun scenario={scenario} />;
}

export function GovernanceTourArenaDemo() {
  const scenario = useArenaScenario('platformGovernance');
  return <ChatArena scenario={scenario} />;
}

export function GovernanceTourAgentsDemo() {
  const scenario = useAgentsScenario('platformGovernance');
  return <ConnectAgents scenario={scenario} />;
}

export function GovernanceTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformGovernance');
  return <KnowledgePool scenario={scenario} />;
}

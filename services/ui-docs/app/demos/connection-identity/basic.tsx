import { ConnectionIdentity } from '@tale/ui/connection-identity';
import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';
import { TaleLogo } from '@tale/ui/logo';
import { Bot } from 'lucide-react';

export default function ConnectionIdentityBasic() {
  return (
    <div className="flex flex-col items-center gap-6">
      <ConnectionIdentity
        label="Claude Code connecting to Tale"
        from={<ClaudeIcon />}
        to={<TaleLogo wordmark={false} />}
      />
      <ConnectionIdentity
        label="Codex connecting to Tale"
        from={<OpenAIIcon />}
        to={<TaleLogo wordmark={false} />}
      />
      <ConnectionIdentity
        label="An unverified app connecting to Tale"
        from={<Bot />}
        to={<TaleLogo wordmark={false} />}
      />
    </div>
  );
}

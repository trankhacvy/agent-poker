import type { AgentData } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import { Button } from "@/components/ui/button";

interface AgentCardProps {
  agent: AgentData;
  onFund: (publicKey: string) => void;
  onWithdraw: (publicKey: string) => void;
}

export default function AgentCard({ agent, onFund, onWithdraw }: AgentCardProps) {
  const template = TEMPLATES[agent.templateId];

  return (
    <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-5 border-b border-neutral-50/10">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden"
          style={{ backgroundColor: `${template.color}20` }}
        >
          <img src={template.avatar} alt={template.name} className="w-full h-full object-cover" />
        </div>
        <div>
          <h3 className="font-semibold text-neutral-50">{agent.displayName}</h3>
          <p className="text-sm text-neutral-200">{template.name}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-neutral-500/50 px-3 py-2.5">
            <div className="text-xs text-neutral-300">Games</div>
            <div className="text-lg font-semibold text-neutral-50">
              {agent.gamesPlayed}
            </div>
          </div>
          <div className="rounded-xl bg-neutral-500/50 px-3 py-2.5">
            <div className="text-xs text-neutral-300">Wins</div>
            <div className="text-lg font-semibold text-violet">
              {agent.wins}
            </div>
          </div>
          <div className="rounded-xl bg-neutral-500/50 px-3 py-2.5">
            <div className="text-xs text-neutral-300">Earnings</div>
            <div className="text-lg font-semibold text-gold">
              {agent.earnings.toFixed(2)} SOL
            </div>
          </div>
          <div className="rounded-xl bg-neutral-500/50 px-3 py-2.5">
            <div className="text-xs text-neutral-300">Balance</div>
            <div className="text-lg font-semibold text-neutral-50">
              {agent.balance.toFixed(2)} SOL
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 p-5 border-t border-neutral-50/10">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => onFund(agent.publicKey)}
        >
          Fund
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => onWithdraw(agent.publicKey)}
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
}

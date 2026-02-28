import type { AgentData } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

interface AgentCardProps {
  agent: AgentData;
  onFund: (publicKey: string) => void;
  onWithdraw: (publicKey: string) => void;
}

const templateEmojis = ["🦈", "🔥", "🪨", "🦊"];

export default function AgentCard({ agent, onFund, onWithdraw }: AgentCardProps) {
  const template = TEMPLATES[agent.templateId];

  return (
    <Card className="bg-zinc-900/60">
      <CardHeader className="flex-row items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
          style={{ backgroundColor: `${template.color}20` }}
        >
          {templateEmojis[agent.templateId]}
        </div>
        <div>
          <h3 className="font-semibold text-zinc-100">{agent.displayName}</h3>
          <p className="text-sm text-zinc-500">{template.name}</p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="text-xs text-zinc-500">Games</div>
            <div className="text-lg font-semibold text-zinc-200">
              {agent.gamesPlayed}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="text-xs text-zinc-500">Wins</div>
            <div className="text-lg font-semibold text-emerald-400">
              {agent.wins}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="text-xs text-zinc-500">Earnings</div>
            <div className="text-lg font-semibold text-amber-400">
              {agent.earnings.toFixed(2)} SOL
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2">
            <div className="text-xs text-zinc-500">Balance</div>
            <div className="text-lg font-semibold text-zinc-200">
              {agent.balance.toFixed(2)} SOL
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          onClick={() => onFund(agent.publicKey)}
        >
          Fund
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onWithdraw(agent.publicKey)}
        >
          Withdraw
        </Button>
      </CardFooter>
    </Card>
  );
}

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
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
          style={{ backgroundColor: `${template.color}20` }}
        >
          {templateEmojis[agent.templateId]}
        </div>
        <div>
          <h3 className="font-semibold text-foreground">{agent.displayName}</h3>
          <p className="text-sm text-muted-foreground">{template.name}</p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <div className="border-2 border-border bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">Games</div>
            <div className="text-lg font-semibold text-foreground">
              {agent.gamesPlayed}
            </div>
          </div>
          <div className="border-2 border-border bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">Wins</div>
            <div className="text-lg font-semibold text-primary">
              {agent.wins}
            </div>
          </div>
          <div className="border-2 border-border bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">Earnings</div>
            <div className="text-lg font-semibold text-secondary">
              {agent.earnings.toFixed(2)} SOL
            </div>
          </div>
          <div className="border-2 border-border bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">Balance</div>
            <div className="text-lg font-semibold text-foreground">
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

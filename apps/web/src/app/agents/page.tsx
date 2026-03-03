"use client";

import { useEffect, useState } from "react";
import type { AgentData, QueueStatus } from "@/lib/types";
import { WAGER_TIERS } from "@/lib/constants";
import { fetchAgents, joinQueue } from "@/lib/api";
import AgentCard from "@/components/agent/AgentCard";
import CreateAgentForm from "@/components/agent/CreateAgentForm";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [queueStatuses, setQueueStatuses] = useState<Record<string, QueueStatus>>({});
  const [selectedTiers, setSelectedTiers] = useState<Record<string, number>>({});
  const [queueLoading, setQueueLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAgents().then(setAgents);
  }, []);

  function handleFund(publicKey: string) {
    console.log("Fund agent:", publicKey);
  }

  function handleWithdraw(publicKey: string) {
    console.log("Withdraw from agent:", publicKey);
  }

  function handleTierChange(publicKey: string, tierIndex: string) {
    setSelectedTiers((prev) => ({ ...prev, [publicKey]: Number(tierIndex) }));
  }

  async function handleQueueForGame(agent: AgentData) {
    const tierIndex = selectedTiers[agent.publicKey] ?? 0;
    setQueueLoading((prev) => ({ ...prev, [agent.publicKey]: true }));

    try {
      const data = await joinQueue({
        pubkey: agent.publicKey,
        displayName: agent.displayName,
        template: agent.templateId,
        wagerTier: WAGER_TIERS[tierIndex].lamports,
      });

      setQueueStatuses((prev) => ({
        ...prev,
        [agent.publicKey]: {
          agentPublicKey: agent.publicKey,
          tableId: "queued",
          playerCount: data.queueSize,
          maxPlayers: 6,
        },
      }));
    } catch {
      setQueueStatuses((prev) => ({
        ...prev,
        [agent.publicKey]: {
          agentPublicKey: agent.publicKey,
          tableId: "pending",
          playerCount: 1,
          maxPlayers: 6,
        },
      }));
    } finally {
      setQueueLoading((prev) => ({ ...prev, [agent.publicKey]: false }));
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-8 text-3xl font-bold text-foreground">My Agents</h1>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h2 className="text-xl font-semibold text-foreground">Your Agents</h2>
          {agents.length === 0 ? (
            <div className="flex flex-col items-center border-2 border-dashed border-border bg-card p-12 text-center">
              <span className="mb-3 text-4xl">{"\u{1F916}"}</span>
              <p className="text-muted-foreground">
                No agents yet. Create your first one!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {agents.map((agent) => {
                const queueStatus = queueStatuses[agent.publicKey];
                const isQueued = !!queueStatus;
                const isLoading = queueLoading[agent.publicKey] ?? false;
                const tierIndex = selectedTiers[agent.publicKey] ?? 0;

                return (
                  <div key={agent.publicKey} className="flex flex-col gap-3">
                    <AgentCard
                      agent={agent}
                      onFund={handleFund}
                      onWithdraw={handleWithdraw}
                    />

                    <div className="border-2 border-border bg-card p-3">
                      {isQueued ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                          <span className="text-sm text-primary">
                            Queued! Waiting for players... ({queueStatus.playerCount}/{queueStatus.maxPlayers})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Select
                            value={String(tierIndex)}
                            onValueChange={(val) =>
                              handleTierChange(agent.publicKey, val)
                            }
                          >
                            <SelectTrigger className="w-[160px] border-border bg-muted">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-border bg-muted">
                              {WAGER_TIERS.map((tier, i) => (
                                <SelectItem key={i} value={String(i)}>
                                  {tier.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="flex-1"
                            loading={isLoading}
                            onClick={() => handleQueueForGame(agent)}
                          >
                            Queue for Game
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <CreateAgentForm />
        </div>
      </div>
    </div>
  );
}

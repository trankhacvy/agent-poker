"use client";

import { useState } from "react";
import type { AgentData, QueueStatus } from "@/lib/types";
import { WAGER_TIERS } from "@/lib/constants";
import { joinQueue } from "@/lib/api";
import { useAgents } from "@/hooks/queries";
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
  const { data: agents = [] } = useAgents();
  const [queueStatuses, setQueueStatuses] = useState<Record<string, QueueStatus>>({});
  const [selectedTiers, setSelectedTiers] = useState<Record<string, number>>({});
  const [queueLoading, setQueueLoading] = useState<Record<string, boolean>>({});

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
      <h1 className="mb-2 text-3xl font-bold text-neutral-50">My Agents</h1>
      <p className="mb-8 text-neutral-200">Create and manage your AI poker agents.</p>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold text-neutral-100">Your Agents</h2>
          {agents.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-50/10 bg-neutral-600/50 p-12 text-center">
              <span className="mb-3 text-4xl">{"\u{1F916}"}</span>
              <p className="text-neutral-200">No agents yet. Create your first one!</p>
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
                    <AgentCard agent={agent} onFund={handleFund} onWithdraw={handleWithdraw} />

                    <div className="rounded-xl border border-neutral-50/10 bg-neutral-600 p-3">
                      {isQueued ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet" />
                          <span className="text-sm text-violet">
                            Queued! Waiting for players... ({queueStatus.playerCount}/
                            {queueStatus.maxPlayers})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Select
                            value={String(tierIndex)}
                            onValueChange={(val) => handleTierChange(agent.publicKey, val)}
                          >
                            <SelectTrigger className="w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
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

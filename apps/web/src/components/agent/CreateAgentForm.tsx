"use client";

import { useState } from "react";
import { useAccount } from "@solana/connector";
import { TEMPLATES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateAgentForm() {
  const { connected } = useAccount();
  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
      <div className="p-5 border-b border-neutral-50/10">
        <h2 className="text-lg font-semibold text-neutral-50">Create New Agent</h2>
        <p className="text-sm text-neutral-200 mt-1">Choose a template and name your agent.</p>
      </div>

      <div className="p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label>Choose Template</Label>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all cursor-pointer ${
                  selectedTemplate === template.id
                    ? "border-violet/50 bg-violet/10"
                    : "border-neutral-50/10 bg-neutral-500/30 hover:border-neutral-50/20 hover:bg-neutral-500/50"
                }`}
                onClick={() => setSelectedTemplate(template.id)}
              >
                <img src={template.avatar} alt={template.name} className="w-10 h-10 rounded-lg object-cover" />
                <span className="text-sm font-semibold" style={{ color: template.color }}>
                  {template.name}
                </span>
                <span className="text-xs text-neutral-200">{template.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Display Name</Label>
          <Input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
            maxLength={20}
            placeholder="My Agent"
          />
          <span className="text-xs text-neutral-300">{displayName.length}/20</span>
        </div>

        {!connected ? (
          <p className="text-center text-sm text-neutral-200">
            Connect your wallet to create an agent
          </p>
        ) : (
          <Button
            onClick={handleCreate}
            loading={loading}
            disabled={!displayName.trim()}
          >
            Create Agent
          </Button>
        )}
      </div>
    </div>
  );
}

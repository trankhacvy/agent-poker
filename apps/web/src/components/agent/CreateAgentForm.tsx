"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TEMPLATES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const templateEmojis = ["🦈", "🔥", "🪨", "🦊"];

export default function CreateAgentForm() {
  const { connected } = useWallet();
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-foreground">
          Create New Agent
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label>Choose Template</Label>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                className={`flex flex-col items-center gap-2 border-2 p-4 text-center transition-all ${
                  selectedTemplate === template.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-muted-foreground"
                }`}
                onClick={() => setSelectedTemplate(template.id)}
              >
                <span className="text-3xl">{templateEmojis[template.id]}</span>
                <span
                  className="text-sm font-semibold"
                  style={{ color: template.color }}
                >
                  {template.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {template.description}
                </span>
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
          <span className="text-xs text-muted-foreground">{displayName.length}/20</span>
        </div>

        {!connected ? (
          <p className="text-center text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}

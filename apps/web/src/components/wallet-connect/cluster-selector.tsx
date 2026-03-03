"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCluster, type SolanaClusterId } from "@solana/connector";
import { cn } from "@/lib/utils";

export interface ClusterSelectorProps {
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function ClusterSelector({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  className,
}: ClusterSelectorProps) {
  const { cluster, clusters, setCluster } = useCluster();

  const value = controlledValue ?? cluster?.id ?? "";
  const onValueChange =
    controlledOnValueChange ?? ((id: string) => setCluster(id as SolanaClusterId));

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn("h-8 w-full", className)}>
        <SelectValue placeholder="Select network" />
      </SelectTrigger>
      <SelectContent>
        {clusters.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

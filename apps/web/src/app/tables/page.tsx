"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TableInfo } from "@/lib/types";
import { WAGER_TIERS } from "@/lib/constants";
import { fetchTables } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const filterOptions: (number | "all")[] = ["all", 0, 1, 2, 3];

const statusLabels: Record<string, string> = {
  open: "Open",
  full: "Full",
  "in-progress": "In Progress",
  settled: "Settled",
};

export default function TablesPage() {
  const [filter, setFilter] = useState<string>("all");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTables = useCallback(async () => {
    try {
      const data = await fetchTables();
      setTables(data);
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
    intervalRef.current = setInterval(loadTables, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadTables]);

  const filtered =
    filter === "all"
      ? tables
      : tables.filter((t) => t.wagerTierIndex === Number(filter));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-zinc-100">Tables</h1>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-zinc-600"}`}
            />
            <span className="text-xs text-zinc-500">
              {isConnected ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(val) => val && setFilter(val)}
        className="mb-6 justify-start"
      >
        {filterOptions.map((opt) => (
          <ToggleGroupItem
            key={String(opt)}
            value={String(opt)}
            className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
          >
            {opt === "all" ? "All Tiers" : WAGER_TIERS[opt as number].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/50">
              <TableHead className="text-zinc-500">Table</TableHead>
              <TableHead className="text-zinc-500">Status</TableHead>
              <TableHead className="text-zinc-500">Wager</TableHead>
              <TableHead className="text-zinc-500">Players</TableHead>
              <TableHead className="text-right text-zinc-500">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((table) => (
              <TableRow
                key={table.tableId}
                className="border-b border-zinc-800/50"
              >
                <TableCell className="font-medium text-zinc-200">
                  <Tooltip>
                    <TooltipTrigger className="cursor-default">
                      {table.tableId.slice(0, 8)}...
                    </TooltipTrigger>
                    <TooltipContent>{table.tableId}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Badge variant={table.status}>
                    {statusLabels[table.status] ?? table.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-zinc-300">
                  {WAGER_TIERS[table.wagerTierIndex]?.label ?? "?"}
                </TableCell>
                <TableCell className="text-zinc-400">
                  {table.playerCount}/{table.maxPlayers}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {(table.status === "in-progress" ||
                      table.status === "full") && (
                      <Link href={`/tables/${table.tableId}`}>
                        <Button variant="secondary" size="sm">
                          Spectate
                        </Button>
                      </Link>
                    )}
                    {table.status === "settled" && (
                      <Link href={`/tables/${table.tableId}`}>
                        <Button variant="outline" size="sm">
                          View
                        </Button>
                      </Link>
                    )}
                    {table.status === "open" && (
                      <Link href={`/tables/${table.tableId}`}>
                        <Button variant="secondary" size="sm">
                          View
                        </Button>
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-zinc-600"
                >
                  {isConnected ? (
                    "No tables found for this tier"
                  ) : (
                    <div className="flex flex-col gap-3 w-full max-w-md mx-auto">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

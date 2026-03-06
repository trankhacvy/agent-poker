import { writeFileSync, readFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";

interface PersistedState {
  roundNumber: number;
  activeTableId: string | null;
}

const STATE_FILE = path.join(process.cwd(), ".arena-state.json");

export function loadState(): PersistedState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state), "utf-8");
  renameSync(tmp, STATE_FILE);
}

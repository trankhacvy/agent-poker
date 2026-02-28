export const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "http://localhost:3001";
export const GAME_SERVER_WS_URL = process.env.NEXT_PUBLIC_GAME_SERVER_WS_URL ?? "ws://localhost:3001/ws";

export const AGENT_PROGRAM_ID = "AgPkrAgt11111111111111111111111111111111111";
export const ESCROW_PROGRAM_ID = "AgPkrEsc11111111111111111111111111111111111";
export const BETTING_PROGRAM_ID = "AgPkrBet11111111111111111111111111111111111";
export const GAME_PROGRAM_ID = "4dnm62opQrwADRgKFoGHrpt8zCWkheTRrs3uVCAa3bRr";

export const WAGER_TIERS = [
  { label: "$1", lamports: 0.1e9 },
  { label: "$3", lamports: 0.3e9 },
  { label: "$5", lamports: 0.5e9 },
  { label: "$10", lamports: 1.0e9 },
] as const;

export const TEMPLATES = [
  { id: 0, name: "Shark", description: "Tight and aggressive. Plays few hands but bets big.", color: "#3B82F6" },
  { id: 1, name: "Maniac", description: "Loose and wild. Plays many hands, bluffs often.", color: "#EF4444" },
  { id: 2, name: "Rock", description: "Ultra-conservative. Only plays premium hands.", color: "#6B7280" },
  { id: 3, name: "Fox", description: "Adaptive and tricky. Changes strategy based on opponents.", color: "#F59E0B" },
] as const;

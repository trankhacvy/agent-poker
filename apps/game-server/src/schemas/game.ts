import { Type } from "@sinclair/typebox";

export const GameHistoryPlayerSchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  seatIndex: Type.Number(),
  isWinner: Type.Boolean(),
});

export const GameHistoryRecordSchema = Type.Object({
  gameId: Type.String(),
  tableId: Type.String(),
  wagerTier: Type.Number(),
  pot: Type.Number(),
  winnerIndex: Type.Number(),
  players: Type.Array(GameHistoryPlayerSchema),
  completedAt: Type.Number(),
});

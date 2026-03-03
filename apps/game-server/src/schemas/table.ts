import { Type } from "@sinclair/typebox";

export const PlayerInfoSchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  seatIndex: Type.Number(),
});

export const TableInfoSchema = Type.Object({
  tableId: Type.String(),
  wagerTier: Type.Number(),
  playerCount: Type.Number(),
  maxPlayers: Type.Number(),
  status: Type.Union([
    Type.Literal("open"),
    Type.Literal("full"),
    Type.Literal("in_progress"),
    Type.Literal("settled"),
  ]),
  players: Type.Array(PlayerInfoSchema),
});

export const JoinBodySchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  wagerTier: Type.Number(),
});

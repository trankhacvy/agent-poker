import { Type } from "@sinclair/typebox";

export const AgentSchema = Type.Object({
  pubkey: Type.String(),
  owner: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  vault: Type.String(),
  balance: Type.Number(),
  gamesPlayed: Type.Number(),
  wins: Type.Number(),
  earnings: Type.Number(),
  createdAt: Type.Number(),
});

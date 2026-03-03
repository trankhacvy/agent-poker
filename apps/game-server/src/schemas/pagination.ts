import { Type } from "@sinclair/typebox";

export const PaginationQuerySchema = Type.Object({
  offset: Type.Optional(Type.Number({ default: 0 })),
  limit: Type.Optional(Type.Number({ default: 20 })),
});

export const PubkeyParamsSchema = Type.Object({
  pubkey: Type.String(),
});

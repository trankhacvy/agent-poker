import { Type } from "@sinclair/typebox";

export const ErrorResponseSchema = Type.Object({
  statusCode: Type.Number(),
  message: Type.String(),
});

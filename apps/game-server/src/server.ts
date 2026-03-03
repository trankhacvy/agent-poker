import "dotenv/config";
import { buildApp } from "./app.js";

const app = await buildApp();

const port = app.env.PORT;

await app.listen({ port, host: "0.0.0.0" });

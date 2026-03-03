import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlDir = resolve(__dirname, "../../../target/idl");
const outDir = resolve(__dirname, "../src/generated");

const programs = [
  { idl: "agent_poker_agent.json", out: "agent" },
  { idl: "agent_poker_escrow.json", out: "escrow" },
  { idl: "agent_poker_game.json", out: "game" },
  { idl: "agent_poker_betting.json", out: "betting" },
];

for (const { idl, out } of programs) {
  const idlPath = resolve(idlDir, idl);
  console.log(`Reading IDL: ${idlPath}`);
  const idlJson = JSON.parse(readFileSync(idlPath, "utf-8"));

  const rootNode = rootNodeFromAnchor(idlJson);
  const codama = createFromRoot(rootNode);

  const outputPath = resolve(outDir, out);
  console.log(`Generating client: ${outputPath}`);
  codama.accept(renderVisitor(outputPath));
  console.log(`Done: ${out}`);
}

console.log("All clients generated successfully.");

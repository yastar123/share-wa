import { readFile, writeFile } from "node:fs/promises";

const indexPath = new URL("../api-zod/src/index.ts", import.meta.url);
const source = await readFile(indexPath, "utf8");
const generatedTypesExport = "export * from './generated/types';";
const lines = source.split(/\r?\n/);

if (!lines.some((line) => line.trim() === generatedTypesExport)) {
  throw new Error("Orval's generated Zod barrel export was not found.");
}

const output = lines
  .filter((line) => line.trim() !== generatedTypesExport)
  .join("\n")
  .replace(/\n*$/, "\n");
await writeFile(indexPath, output);

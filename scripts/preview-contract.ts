import { readFile, writeFile } from "node:fs/promises";
import { generateContractPdf } from "../src/server/documents/pdf";
import { contractDataSchema } from "../src/lib/documents";

async function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) throw new Error("Usage: node --conditions=react-server --import tsx scripts/preview-contract.ts input.json output.pdf");
  const input = contractDataSchema.parse(JSON.parse(await readFile(inputFile, "utf8")));
  await writeFile(outputFile, await generateContractPdf(input));
  console.log("PDF generated.");
}
void main().catch(() => { console.error("PDF preview failed. Check the input file and document data."); process.exitCode = 1; });

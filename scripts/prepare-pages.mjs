import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = join(process.cwd(), "dist", "client");
const indexPath = join(outputDirectory, "index.html");
const repositoryBase = "/Code_Flash_Tool/";

const html = await readFile(indexPath, "utf8");
const pagesHtml = html.replaceAll(
  '"/science-utsav-logo.png"',
  `"${repositoryBase}science-utsav-logo.png"`,
);

await writeFile(indexPath, pagesHtml, "utf8");
await writeFile(join(outputDirectory, ".nojekyll"), "", "utf8");

import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "www");
await mkdir(output, { recursive: true });

for (const file of ["index.html", "app.js", "styles.css", "manifest.json", "service-worker.js"]) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "icons"), resolve(output, "icons"), { recursive: true });
console.log("AUREON web assets copied to www/");

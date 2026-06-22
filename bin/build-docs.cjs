/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const docsDir = path.join(root, "docs");
const readme = path.join(root, "README.md");

fs.rmSync(docsDir, { recursive: true, force: true });
fs.mkdirSync(docsDir, { recursive: true });
fs.copyFileSync(readme, path.join(docsDir, "README.md"));

console.log(`Documentation copied to ${docsDir}`);

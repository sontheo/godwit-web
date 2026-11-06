import { readdir, readFile, writeFile } from "node:fs/promises";
// The browser editor needs only these namespaces. Keep full desktop catalogs out
// of the initial mailbox bundle; other languages can load independently.
for (const name of await readdir("../internal/i18n")) {
  if (!name.endsWith(".json")) continue;
  const data = JSON.parse(await readFile(`../internal/i18n/${name}`, "utf8"));
  const subset = Object.fromEntries(
    Object.entries(data).filter(([key]) => /^(compose_|common_|error_)/.test(key)),
  );
  await writeFile(`src/browser/locales/${name}`, JSON.stringify(subset));
}

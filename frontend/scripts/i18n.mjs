// npm run i18n          regenerate src/i18n/en.ts and re-file translations (new keys are added empty)
// npm run i18n -- --check   fail if the catalog is stale, a translation is missing or text is hard-coded
import fs from "node:fs";
import path from "node:path";

import { I18N, LANGS, areas, extract, hardCoded, readDictionary, renderEnglish, writeDictionary } from "./i18n-lib.mjs";

const check = process.argv.includes("--check");
const { keys, problems } = extract();
const english = renderEnglish(keys);
const enFile = path.join(I18N, "en.ts");
let failed = problems.length > 0;
problems.forEach((p) => console.error(p));

if (check) {
  if (fs.readFileSync(enFile, "utf8") !== english) {
    console.error("src/i18n/en.ts is out of date: run `npm run i18n`");
    failed = true;
  }
  for (const lang of LANGS) {
    const dict = readDictionary(lang);
    const missing = [...keys.keys()].filter((k) => !dict[k]);
    const extra = Object.keys(dict).filter((k) => !keys.has(k));
    if (missing.length) console.error(`${lang}: ${missing.length} untranslated, e.g. ${JSON.stringify(missing.slice(0, 5))}`);
    if (extra.length) console.error(`${lang}: ${extra.length} unused, e.g. ${JSON.stringify(extra.slice(0, 5))}`);
    failed ||= missing.length > 0 || extra.length > 0;
  }
} else {
  fs.writeFileSync(enFile, english);
  const byArea = areas(keys);
  for (const lang of LANGS) {
    const missing = writeDictionary(lang, byArea);
    console.log(`${lang}: ${keys.size} keys, ${missing.length} untranslated`);
  }
}

const loose = hardCoded();
if (loose.length) {
  console.error(`Hard-coded text (wrap it in t()):\n${loose.join("\n")}`);
  failed = true;
}
process.exit(failed ? 1 : 0);

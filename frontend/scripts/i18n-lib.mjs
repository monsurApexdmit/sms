// Message catalog tooling, shared by scripts/i18n.mjs (CLI) and src/i18n/i18n.test.ts.
//
// Keys are the English text passed to t()/tn()/tp() (under any import alias) plus the
// strings listed in src/i18n/dynamic.ts. Each key belongs to one area (the page it is
// used on; keys used in several areas go to "common"), which decides the dictionary file
// it lives in under src/i18n/<lang>/.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = path.join(ROOT, "src");
export const I18N = path.join(SRC, "i18n");
export const LANGS = ["bn"];
const FUNCS = ["t", "tn", "tp"];

/** Text in these elements is code, CSS or data, not language. */
const CODE_TAGS = new Set(["code", "kbd", "pre", "samp", "style", "script"]);
/** Attributes whose string values are read by people (checked for hard-coded text). */
export const TEXT_ATTRS = new Set(["label", "title", "placeholder", "emptyText", "subtitle", "description", "aria-label", "hint", "alt", "nameLabel", "namePlaceholder", "eyebrow", "confirmLabel", "cancelLabel"]);
/** Hard-coded JSX text that is allowed (data formats, product names shown verbatim). */
export const ALLOWED_TEXT = new Set(["StudentName,Id,Email,Password,Phone,Address,ParentID,Gender", "POST"]);

export function sourceFiles(dir = SRC) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "test" || p === I18N) continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** "pages/Finance.tsx" -> "finance"; components, layouts and top-level files -> "common". */
export function areaOf(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts[0] !== "pages") return "common";
  const name = parts.length > 2 ? parts[1] : parts[1].replace(/\.tsx?$/, "");
  if (name === "public") return "publicSite"; // `public` is a reserved word
  return name.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase());
}

function importedNames(sf) {
  // local name -> i18n function name
  const names = {};
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !/(^|\/)i18n$/.test(st.moduleSpecifier.text)) continue;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) {
      const name = (el.propertyName ?? el.name).text;
      if (FUNCS.includes(name)) names[el.name.text] = name;
    }
  }
  return names;
}

/** Every catalog key with the files that use it, plus problems (non-literal keys). */
export function extract() {
  const keys = new Map(); // key -> Set(rel)
  const problems = [];
  const add = (k, rel) => (keys.get(k) ?? keys.set(k, new Set()).get(k)).add(rel);
  const files = [...sourceFiles(), path.join(I18N, "dynamic.ts")];
  for (const file of files) {
    const rel = path.relative(SRC, file);
    const sf = parse(file);
    const local = file.endsWith(path.join("i18n", "dynamic.ts")) ? { t: "t" } : importedNames(sf);
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && local[n.expression.text]) {
        const fn = local[n.expression.text];
        const args = fn === "tp" ? n.arguments.slice(1, 3) : n.arguments.slice(0, 1);
        for (const a of args) {
          if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) add(a.text, rel);
          else problems.push(`${rel}:${sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1}: ${fn}() needs a string literal key`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { keys, problems };
}

export function areas(keys) {
  const byArea = {};
  for (const [k, files] of keys) {
    const a = new Set([...files].map(areaOf));
    const area = a.size === 1 ? [...a][0] : "common";
    (byArea[area] ??= []).push(k);
  }
  for (const list of Object.values(byArea)) list.sort((x, y) => x.localeCompare(y));
  return byArea;
}

const PLACEHOLDER = /\{(\w+)\}/g;
export const placeholders = (s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

/** JSX text and text attributes that are not translated. */
export function hardCoded() {
  const out = [];
  for (const file of sourceFiles()) {
    const rel = path.relative(SRC, file);
    if (rel.startsWith(`components${path.sep}ui${path.sep}`)) continue; // shadcn primitives: only screen-reader labels, passed in by callers
    const sf = parse(file);
    const at = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n, inCode) => {
      if (ts.isJsxElement(n)) inCode = inCode || CODE_TAGS.has(n.openingElement.tagName.getText(sf));
      if (ts.isJsxText(n) && !inCode) {
        const text = n.text.replace(/\s+/g, " ").trim();
        if (/[A-Za-z]/.test(text) && !ALLOWED_TEXT.has(text)) out.push(`${at(n)}: ${text}`);
      }
      if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer) && /[A-Za-z]/.test(n.initializer.text))
        out.push(`${at(n)}: ${n.name.getText(sf)}="${n.initializer.text}"`);
      ts.forEachChild(n, (c) => visit(c, inCode));
    };
    visit(sf, false);
  }
  return out;
}

export function readDictionary(lang) {
  const dir = path.join(I18N, lang);
  const dict = {};
  if (!fs.existsSync(dir)) return dict;
  for (const f of fs.readdirSync(dir)) {
    if (f === "index.ts" || !f.endsWith(".ts")) continue;
    const sf = parse(path.join(dir, f));
    const visit = (n) => {
      if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isIdentifier(n.name)) && ts.isStringLiteral(n.initializer)) dict[n.name.text] = n.initializer.text;
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return dict;
}

const q = (s) => JSON.stringify(s);
const HEADER = "// Generated by `npm run i18n` from the t()/tn()/tp() calls in src. Do not edit by hand.\n";

export function renderEnglish(keys) {
  const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b));
  return `${HEADER}\n/** The English catalog: every message key (the English text itself). */\nexport const en = {\n${sorted.map((k) => `  ${q(k)}: ${q(k)},`).join("\n")}\n} as const;\n\nexport type MessageKey = keyof typeof en;\n`;
}

/** Writes src/i18n/<lang>/<area>.ts files and index.ts, keeping existing translations. Returns untranslated keys. */
export function writeDictionary(lang, byArea) {
  const dir = path.join(I18N, lang);
  fs.mkdirSync(dir, { recursive: true });
  const old = readDictionary(lang);
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".ts")) fs.rmSync(path.join(dir, f));
  const missing = [];
  const names = Object.keys(byArea).sort();
  for (const area of names) {
    const lines = byArea[area].map((k) => {
      const v = old[k] ?? "";
      if (!v) missing.push(k);
      return `  ${q(k)}: ${q(v)},${v ? "" : " // untranslated"}`;
    });
    fs.writeFileSync(
      path.join(dir, `${area}.ts`),
      `// ${lang} messages used by ${area === "common" ? "several pages and shared components" : `pages/${area}`}. Keys are the English text.\n// Keep {placeholders} exactly as in the key. Run \`npm run i18n\` after changing source strings.\n\nexport const ${area}: Record<string, string> = {\n${lines.join("\n")}\n};\n`,
    );
  }
  fs.writeFileSync(
    path.join(dir, "index.ts"),
    `${HEADER}import type { MessageKey } from "../en";\n${names.map((a) => `import { ${a} } from "./${a}";`).join("\n")}\n\nexport const ${lang} = { ${names.map((a) => `...${a}`).join(", ")} } as Record<MessageKey, string>;\n`,
  );
  return missing;
}

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const forbidden = /[\u2013\u2014]/u;
const entities = (text: string) => text.replace(/&(?:mdash|ndash|#(?:x[0-9a-f]+|[0-9]+));/gi, entity => {
  if (entity.toLowerCase() === "&mdash;") return "\u2014";
  if (entity.toLowerCase() === "&ndash;") return "\u2013";
  const value = entity.slice(2, -1), code = value[0]?.toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});

// Conservatively scan all production literals, including shared/server errors
// that can reach a player. Comments and test fixtures are not product copy.
function copyViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  const check = (text: string, offset: number) => {
    if (forbidden.test(text)) violations.push(`${file}:${source.slice(0, offset).split("\n").length}`);
  };
  if (/\.tsx?$/.test(file)) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        check(ts.isJsxAttribute(node.parent) ? entities(node.text) : node.text, node.getStart(tree));
      } else if (ts.isJsxText(node)) check(entities(node.text), node.getStart(tree));
      ts.forEachChild(node, visit);
    };
    visit(tree);
  } else {
    if (file.endsWith(".html")) {
      // index.html contains only markup/metadata; all text and attributes count.
      const clean = source.replace(/<!--[^]*?-->/g, comment => comment.replace(/[^\n]/g, " "));
      for (const match of clean.matchAll(/"[^"<>]*"|'[^'<>]*'|[^<>]+(?=<|$)/g)) check(entities(match[0]), match.index);
    } else {
      // Quoted CSS strings include generated content. Tokenizing comments
      // alongside strings preserves comment-like text inside a literal.
      for (const literal of source.matchAll(/\/\*[^]*?\*\/|"(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'/g)) {
        if (literal[0].startsWith("/*")) continue;
        const decoded = literal[0].replace(/\\([0-9a-f]{1,6})\s?|\\([^])/gi, (_, hex: string, char: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char);
        check(decoded, literal.index);
      }
    }
  }
  return violations;
}

test("copy scanner decodes strings, templates, JSX, HTML and CSS while ignoring comments", () => {
  for (const source of [
    'const a = "Downed — help";', "const a = 'Wait – help';",
    String.raw`const a = "\u2014";`, String.raw`const a = '\u{2013}';`,
    'const a = `—${time}–`; ', 'const a = `${time}—${end}`;',
    '<p>Help &mdash; now</p>', '<p>Help &#8211; now</p>', '<p title="&#x2014;">Help</p>',
    '<p title="&ndash;"/>', '<p title={"—"}/>', '<p>–</p>',
  ]) expect(copyViolations("fixture.tsx", source).length, source).toBeGreaterThan(0);
  expect(copyViolations("fixture.ts", '// —\n/* – */ const a = "Downed. A teammate can revive you.";')).toEqual([]);
  expect(copyViolations("fixture.tsx", '<p>{/* — */}Help</p>')).toEqual([]);
  expect(copyViolations("fixture.ts", '\nconst a = "—";')).toEqual(["fixture.ts:2"]);
  for (const source of ['<title>Bug — Swarm</title>', '<meta content="&#x2013;"/>', '<p>&mdash;</p>'])
    expect(copyViolations("index.html", source).length).toBeGreaterThan(0);
  expect(copyViolations("index.html", '<!-- — --><title>Bug Swarm</title>')).toEqual([]);
  for (const source of ['a::after { content: "—"; }', 'a::after { content: "/*—*/"; }', String.raw`a::after { content: '\2013 '; }`])
    expect(copyViolations("fixture.css", source).length).toBeGreaterThan(0);
  expect(copyViolations("fixture.css", '/* — */ a::after { content: "…"; }')).toEqual([]);
});

test("production copy contains no em or en dashes", () => {
  const root = resolve(import.meta.dir, ".."), violations: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(test|test-support)\./.test(entry.name))
        violations.push(...copyViolations(path, readFileSync(path, "utf8")));
    }
  };
  scan(root);
  const html = resolve(root, "../index.html");
  violations.push(...copyViolations(html, readFileSync(html, "utf8")));
  expect(violations).toEqual([]);
});

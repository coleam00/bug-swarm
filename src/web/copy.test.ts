import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import ts from "typescript";

const forbidden = /[\u2013\u2014]/u;
const entities = (text: string) => text.replace(/&(?:mdash|ndash|#(?:x[0-9a-f]+|[0-9]+));/gi, entity => {
  if (entity.toLowerCase() === "&mdash;") return "\u2014";
  if (entity.toLowerCase() === "&ndash;") return "\u2013";
  const value = entity.slice(2, -1), code = value[0]?.toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});

// Client copy and server message boundaries, rather than server diagnostics.
// Comments and test fixtures are not product copy.
function copyViolations(file: string, source: string, scope: "client" | "messages" = "client"): string[] {
  const violations: string[] = [];
  const check = (text: string, offset: number) => {
    if (forbidden.test(text)) violations.push(`${file}:${source.slice(0, offset).split("\n").length}`);
  };
  if (/\.tsx?$/.test(file)) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node, include = scope === "client") => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.expression.getText(tree) === "console" || node.expression.getText(tree) === "this.log")) return;
      if (ts.isNewExpression(node) && node.expression.getText(tree) === "Error") return;
      if (!include) {
        // API/name errors, arena refusals and the shared moderation message
        // reach players; the other server literals are implementation details.
        if (ts.isPropertyAssignment(node) && ["error", "message"].includes(node.name.getText(tree).replace(/["']/g, ""))) visit(node.initializer, true);
        else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "refuse") {
          if (node.arguments[2]) visit(node.arguments[2], true);
        } else if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "HIDDEN_IDENTITY_MESSAGE" && node.initializer) visit(node.initializer, true);
        else ts.forEachChild(node, child => visit(child, false));
        return;
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        check(ts.isJsxAttribute(node.parent) ? entities(node.text) : node.text, node.getStart(tree));
      } else if (ts.isJsxText(node)) check(entities(node.text), node.getStart(tree));
      ts.forEachChild(node, child => visit(child, include));
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

test("copy scanning covers player messages and excludes diagnostics", () => {
  const diagnostics = 'console.error("Shutdown failed — unable to save"); throw new Error("Config – invalid");';
  expect(copyViolations("main.ts", diagnostics, "messages")).toEqual([]);
  expect(copyViolations("client.ts", diagnostics + ' this.log("Read failed — retrying");')).toEqual([]);
  for (const message of [
    'return { error: "Use 2–16 letters." };',
    'return c.json({ error: valid ? "Fine" : `Invalid — ${name}` });',
    'send({ type: "error", message: "Try again — later" });',
    'this.refuse(c, "invalid", "That name — refused");',
    'export const HIDDEN_IDENTITY_MESSAGE = "Name – hidden";',
  ]) expect(copyViolations("server.ts", diagnostics + message, "messages").length, message).toBeGreaterThan(0);
});

test("player-facing copy contains no em or en dashes", () => {
  const root = resolve(import.meta.dir, ".."), violations: string[] = [];
  const messageSources = new Set(["server/rules.ts", "server/app.ts", "server/arena/rooms.ts", "shared/arena/protocol.ts"].map(path => join(root, path)));
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(test|test-support)\./.test(entry.name)) {
        const clientCopy = path.startsWith(join(root, "web") + sep) ||
          path === join(root, "shared/teams.ts") || path === join(root, "server/share-assets.ts");
        if (clientCopy || messageSources.has(path))
          violations.push(...copyViolations(path, readFileSync(path, "utf8"), clientCopy ? "client" : "messages"));
      }
    }
  };
  scan(root);
  const html = resolve(root, "../index.html");
  violations.push(...copyViolations(html, readFileSync(html, "utf8")));
  expect(violations).toEqual([]);
});

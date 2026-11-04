const test = require("node:test");
const assert = require("node:assert");
const Y = require("../src/yadro.js");
const V = require("../src/perevod-v.js");
function out(src) { const lines = []; Y.execute(src, { io: { print: (s) => lines.push(s), ask: () => "" } }); return lines.join("\n"); }
test("короткие слова: пиши, повтори, пробуй, конст", () => {
  const src = 'конст Н = 2\nповтори Н раз\n    пиши "1"\nконец\nпробуй\n    брось "х"\nесли ошибка как е\n    Пиши "поймано"\nконец\n';
  const js = Y.compile(src);
  assert.ok(js.length > 0);
});
test("старые слова по-прежнему работают", () => { assert.ok(Y.compile('константа А = 1\nнапиши А\n').length > 0); });
test("перевод с Python пишет короткую форму", () => { const r = V.translateToPon('print("1")\n', "python"); assert.match(r.code, /^пиши "1"/m); });
test("translateAstToPon: узлы PonNote и PonUnsupported", () => {
  const L = { start: { line: 1 } };
  const ast = { type: "Program", body: [{ type: "PonNote", text: "исходник: goto x", loc: L }, { type: "ExpressionStatement", loc: L, expression: { type: "CallExpression", callee: { type: "Identifier", name: "print" }, arguments: [{ type: "PonUnsupported", text: "не переводится" }] } }] };
  const r = V.translateAstToPon(ast, "javascript");
  assert.match(r.code, /goto x/);
});

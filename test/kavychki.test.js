const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Y = require("../src/yadro");

const r = (src, answers) => Y.run(src, { ask: () => (answers || []).shift() });
const fails = (src, re) => assert.throws(() => r(src), (e) => { assert.match(e.message, re); return true; });
const val = (src) => {
  const out = r("пиши " + src);
  assert.strictEqual(out.length, 1, src);
  return out[0];
};

const FORMS = [
  ['машинные двойные', '"привет"'],
  ['машинные одинарные', "'привет'"],
  ['обратные', '`привет`'],
  ['ёлочки', '«привет»'],
  ['одинарные ёлочки', '‹привет›'],
  ['лапки по Розенталю', '„привет“'],
  ['лапки с польским закрытием', '„привет”'],
  ['английские типографские', '“привет”'],
  ['английские одинарные', '‘привет’'],
  ['нижние одинарные немецкие', '‚привет‘'],
  ['нижние одинарные польские', '‚привет’'],
  ['финские двойные', '”привет”'],
  ['финские одинарные', '’привет’']
];

test("каждый вид кавычек читается как строка", () => {
  for (const [name, src] of FORMS) {
    assert.strictEqual(val(src), "привет", name + ": " + src);
    assert.strictEqual(val(src[0] + src[src.length - 1]), "", "пустая " + name);
  }
});

test("вложенные кавычки по русской типографике", () => {
  assert.strictEqual(val('«книга „Война и мир“»'), "книга „Война и мир“");
  assert.strictEqual(val('«книга „Война и мир”»'), "книга „Война и мир”");
  assert.strictEqual(val('«внешняя «внутренняя» ещё»'), "внешняя «внутренняя» ещё");
  assert.strictEqual(val('‹внешняя ‹внутренняя› ещё›'), "внешняя ‹внутренняя› ещё");
  assert.strictEqual(val('"текст «внутри» и „лапки“"'), "текст «внутри» и „лапки“");
  assert.strictEqual(val('“текст «внутри»”'), "текст «внутри»");
});

test("шаблоны {выражение} работают в любом виде кавычек", () => {
  assert.strictEqual(val('«Ёлки {1 + 1}»'), "Ёлки 2");
  assert.strictEqual(val('“hi {1 + 1}”'), "hi 2");
  assert.strictEqual(val("'hi {1 + 1}'"), "hi 2");
  assert.strictEqual(val("`hi {1 + 1}`"), "hi 2");
  assert.strictEqual(val('„сумма {2 * 3}“'), "сумма 6");
  assert.strictEqual(val('‹x {10}›'), "x 10");
  assert.deepStrictEqual(r('пусть имя = «Аня»\nпиши “Привет, {имя}!”'), ["Привет, Аня!"]);
  assert.strictEqual(val('«a {"b"} c»'), "a b c");
});

test("экранирование кавычек и прежние последовательности", () => {
  assert.strictEqual(val("'it\\'s'"), "it's");
  assert.strictEqual(val('"скажи \\"да\\""'), "скажи \"да\"");
  assert.strictEqual(val('«скажи \\«да\\»»'), "скажи «да»");
  assert.strictEqual(val('“скажи \\”ещё\\””'), "скажи ”ещё”");
  assert.strictEqual(val('"строка\\nвторая"'), "строка\nвторая");
  assert.strictEqual(val('«код \\u{263A}»'), "код ☺");
  assert.strictEqual(val('"скобки \\{и\\}"'), "скобки {и}");
});

test("незакрытая и непарная кавычка — понятная ошибка", () => {
  fails('пиши "abc', /Строка 1, столбец 6: строка не закрыта кавычкой: открыта кавычкой «"», закрыть её нужно кавычкой «"»/);
  fails("пиши «abc", /строка не закрыта кавычкой: открыта кавычкой ««», закрыть её нужно кавычкой «»»/);
  fails('пиши «привет"', /строка не закрыта кавычкой: открыта кавычкой ««», закрыть её нужно кавычкой «»»/);
  fails('пиши “привет«', /открыта кавычкой «“», закрыть её нужно кавычкой «”»/);
  fails("пиши 'abc", /открыта кавычкой «'», закрыть её нужно кавычкой «'»/);
  fails("пиши «abc\nпиши 1", /строка не закрыта кавычкой/);
  fails("пиши „текст", /открыта кавычкой «„», закрыть её нужно кавычкой «“» или «”»/);
  fails("пиши »привет«", /закрывающая кавычка/);
  fails("пиши ›привет‹", /закрывающая кавычка/);
});

test("апостроф внутри строки и известная ловушка одинарных кавычек", () => {
  assert.strictEqual(val('"it\'s fine"'), "it's fine");
  assert.strictEqual(val("«it’s fine»"), "it’s fine");
  assert.strictEqual(val("'it\\'s fine'"), "it's fine");
  fails("пиши 'it's'", /строка не закрыта кавычкой|ожидался конец строки|непонятн/);
});

test("обратные кавычки — это строки, вставки только через { }, не как в JavaScript", () => {
  assert.strictEqual(val("`просто`"), "просто");
  assert.deepStrictEqual(r("пусть имя = «Ваня»\nпиши `привет {имя}`"), ["привет Ваня"]);
  assert.deepStrictEqual(r("пусть имя = «Ваня»\nпиши `привет ${имя}`"), ["привет $Ваня"]);
});

test("комментарии не зависят от кавычек, строки с # и // остаются строками", () => {
  assert.deepStrictEqual(r("# «незакрытая\n// \"тоже\nпиши «ок»"), ["ок"]);
  assert.strictEqual(val('«есть # и // внутри»'), "есть # и // внутри");
});

test("опечатка в служебном слове по-прежнему исправляется перед типографской строкой", () => {
  const w = [];
  const out = Y.run("напишы «да»", { warn: (x) => w.push(x) });
  assert.deepStrictEqual(out, ["да"]);
  assert.ok(w.some((x) => /опечатка «напишы» исправлена на «напиши»|исправлена на «пиши»/.test(x.text)));
});

test("кавычки в ключах словаря и рядом на одной строке", () => {
  assert.deepStrictEqual(r('пусть д = {«а»: 1, “б”: 2}\nпиши д[«а»], д[“б”]'), ["1 2"]);
  assert.deepStrictEqual(r('пиши "а", «б», “в”'), ["а б в"]);
});

test("примеры из репозитория по-прежнему выполняются", () => {
  const dir = path.join(__dirname, "../primery");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".pon"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const STD = require("../src/std.js");
    const out = Y.run(src, { ask: () => "5", gfx: { call: () => null, busy: () => false }, write: () => {}, resolve: (p) => { const m = String(p).match(/^стд\/(.+)$/); if (m) return { id: "стд:" + m[1], name: p, source: STD[m[1]] }; return { id: p, name: p, source: fs.readFileSync(path.join(dir, p), "utf8") }; } });
    assert.ok(out.length > 0, f);
  }
});

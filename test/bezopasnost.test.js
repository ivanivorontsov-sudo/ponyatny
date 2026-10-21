const test = require("node:test");
const assert = require("node:assert");
const Y = require("../src/yadro");
const IZ = require("../src/perevod-iz");
const V = require("../src/perevod-v");

const r = (src) => Y.run(src, { ask: () => "" });
const fails = (src, re) => assert.throws(() => r(src), (e) => { assert.match(e.message, re); return true; });

test("строки не могут внедрить JavaScript", () => {
  const evil = ["\"); throw 1; (\"", "`${1}`", "\\u2028", "</script><script>", "${__R}", "'\\'"];
  for (const s of evil) {
    const src = "напиши " + JSON.stringify(s).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
    assert.deepStrictEqual(r(src), [s]);
  }
  assert.deepStrictEqual(r("пусть x = 1\nнапиши \"а{x}б\\{x\\}\""), ["а1б{x}"]);
  assert.deepStrictEqual(r("напиши \"\\u{263A}\\u{1F600}\""), ["☺😀"]);
  fails("напиши \"\\u{D800}\"", /код символа/);
  fails("напиши \"\\u263A\"", /код символа/);
});

test("нет доступа к внутренностям JavaScript (constructor, __proto__, prototype)", () => {
  const cls = "класс А\n    пусть п = 1\nконец\nпусть а = новый А()\n";
  for (const k of ["constructor", "__proto__", "prototype", "__init", "__cls", "toString", "valueOf", "hasOwnProperty", "__defineGetter__", "call", "apply", "bind"]) {
    fails(cls + "напиши а." + k, /внутреннее имя/);
    fails("напиши \"x\"." + k, /внутреннее имя/);
    fails("напиши [1]." + k + "()", /внутреннее имя/);
  }
  fails("класс Б\n    пусть __proto__ = 1\nконец", /служебное для JavaScript/);
  fails("класс Б\n    функция constructor()\n    конец\nконец", /служебное для JavaScript/);
  assert.deepStrictEqual(r("пусть д = {\"__proto__\": 1, \"constructor\": 2}\nнапиши д[\"__proto__\"] + д[\"constructor\"]"), ["3"]);
  const R = Y.makeRuntime({ write() {} });
  const obj = { __cls: "А" };
  assert.throws(() => R.set(obj, "__proto__", {}), /внутреннее имя/);
  assert.throws(() => R.get(obj, "constructor"), /нет поля/);
  assert.throws(() => R.get("x", "constructor"), /нет поля/);
  assert.throws(() => R.call([], "constructor", []), /нет функции/);
  assert.strictEqual(Object.getPrototypeOf(obj), Object.prototype);
  assert.strictEqual({}.polluted, undefined);
});

test("Trojan Source (CVE-2021-42574) и невидимые символы отклоняются", () => {
  for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]) {
    const ch = String.fromCodePoint(cp);
    fails("# комментарий " + ch + "\nнапиши 1", /Trojan Source/);
    fails("напиши \"а" + ch + "б\"", /Trojan Source/);
  }
  for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xad]) fails("пусть а" + String.fromCodePoint(cp) + "б = 1", /невидимый символ/);
  assert.deepStrictEqual(r("\uFEFFнапиши 1"), ["1"]);
  assert.deepStrictEqual(r("напиши \"\\u{202E}\" == \"\\u{202E}\""), ["истина"]);
});

test("омоглифы: смешение русских и латинских букв в одном имени", () => {
  fails("пусть сoк = 1", /смешаны русские и латинские буквы.*Возможно, вы имели в виду «сок»/);
  fails("пусть рaзмер = 1", /смешаны/);
  assert.deepStrictEqual(r("пусть get_Имя = 1\nнапиши get_Имя"), ["1"]);
  fails("пусть ﬁle = 1", /совместимая/);
  assert.deepStrictEqual(r("пусть й = 1\nнапиши \u0438\u0306"), ["1"]);
});

test("русские имена: любые буквы кириллицы, цифры, регистр", () => {
  assert.deepStrictEqual(r("пусть Ёжик_2 = 1\nпусть ёжик_2 = 2\nпусть їжак = 3\nнапиши Ёжик_2, ёжик_2, їжак"), ["1 2 3"]);
  const js = Y.compile("пусть привет = 1\nпусть privet = 2\nнапиши привет + privet", { ascii: true });
  assert.ok(/^[\x00-\x7f]*$/.test(js.replace(/"[^"]*"/g, "")), "в коде вне строк только ASCII");
  const R = Y.makeRuntime({ write() {} });
  const lines = [];
  new Function("__R", js)(Object.assign(R, { print: (a) => lines.push(a.join(" ")) }));
  assert.deepStrictEqual(lines, ["3"]);
  const seen = new Map();
  for (const n of ["а", "a", "a$000430", "ж", "zh", "_", "Ж", "ab", "аb_"]) {
    const j = Y.jsIdent(n, true);
    assert.ok(!seen.has(j), "коллизия " + n + " и " + seen.get(j));
    seen.set(j, n);
  }
});

test("транслитерация в другие языки без коллизий", () => {
  const src = "пусть привет = 1\nпусть privet = 2\nпусть class = 3\nпусть ж = 4\nпусть zh = 5\nнапиши привет + privet + class + ж + zh";
  for (const lang of ["python", "javascript", "csharp"]) {
    const code = IZ.translate(src, lang, { latin: true }).code;
    const body = code.slice(code.lastIndexOf("privet") - 200);
    assert.ok(!/привет|\bж\b/.test(body), lang);
    assert.ok(/privet_/.test(code) && /zh_/.test(code) && /class_/.test(code), lang);
  }
  const ren = Y.makeRenamer(new Set(["if"]), Y.transliterate, false);
  const outs = ["привет", "privet", "privet_", "if", "иф", "Щука", "щука"].map(ren);
  assert.strictEqual(new Set(outs).size, outs.length);
  assert.strictEqual(Y.transliterate("Щука_1"), "Shchuka_1");
});

test("перевод в «Понятный»: имена, которых нет в языке, переводятся безопасно", () => {
  const res = V.translateToPon("let $x = 1\nlet getИмя = 2\nlet π = 3\nlet если = 4\nlet если_ = 5\nconsole.log($x + getИмя + π + если + если_)\n", "javascript");
  assert.ok(!res.checkError, res.checkError);
  assert.deepStrictEqual(Y.run(res.code), ["15"]);
  const py = V.translateToPon("ﬁle = 1\nfile = file + 1\nprint(ﬁle)\n", "python");
  assert.deepStrictEqual(Y.run(py.code), ["2"]);
});

test("защита от зависания и переполнения", () => {
  fails("напиши " + "(".repeat(5000) + "1" + ")".repeat(5000), /слишком глубокая вложенность/);
  fails("напиши " + "-".repeat(5000) + "1", /слишком глубокая вложенность/);
  fails("напиши " + "не ".repeat(5000) + "1", /слишком глубокая вложенность/);
  let deep = "";
  for (let i = 0; i < 300; i++) deep += "если истина то\n";
  for (let i = 0; i < 300; i++) deep += "конец\n";
  fails(deep, /слишком глубокая вложенность/);
  fails("пусть с = \"a\"\nповторить 40 раз\n    с = с + с\nконец", /слишком длинная строка/);
  fails("напиши \"a\" * 1e12".replace("1e12", "1000000000000"), /слишком длинная строка/);
  fails("функция ф()\n    верни ф()\nконец\nф()", /рекурсия/);
  fails("пока истина\nконец", /слишком долго/);
  fails("пусть " + "я".repeat(300) + " = 1", /слишком длинное имя/);
  const t = Date.now();
  assert.throws(() => r("напиши " + "ы".repeat(200) + "1"));
  assert.ok(Date.now() - t < 2000);
});

const KW = Y.RESERVED.concat(["x", "у", "1", "\"с\"", "(", ")", "[", "]", "{", "}", ":", ",", ".", "+", "=", "==", "\n", "\n", "{x}", "?.", "|>", "=>", "«", "»", "\\", "#"]);
function rnd(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

test("фаззинг: любые входные данные дают либо результат, либо понятную ошибку", () => {
  const rand = rnd(20261021);
  for (let n = 0; n < 3000; n++) {
    let src = "";
    const len = 1 + Math.floor(rand() * 25);
    for (let i = 0; i < len; i++) src += KW[Math.floor(rand() * KW.length)] + (rand() < 0.7 ? " " : "");
    try {
      Y.run(src, { maxSteps: 2000 });
    } catch (e) {
      const ok = e instanceof Y.CompileError || e.runtime;
      assert.ok(ok, "необработанная ошибка на входе " + JSON.stringify(src) + ": " + (e && e.stack));
      assert.ok(!/внутренняя ошибка/.test(e.message), "внутренняя ошибка на входе " + JSON.stringify(src) + ": " + e.message);
    }
  }
});

test("фаззинг байтами: лексер не падает", () => {
  const rand = rnd(42);
  for (let n = 0; n < 3000; n++) {
    let src = "";
    const len = Math.floor(rand() * 40);
    for (let i = 0; i < len; i++) src += String.fromCharCode(Math.floor(rand() * (rand() < 0.5 ? 128 : 0x2100)));
    try { Y.compile(src); } catch (e) { assert.ok(e instanceof Y.CompileError, JSON.stringify(src) + ": " + e.stack); }
  }
});

test("переводчик не обязателен и не влияет на сборку", () => {
  const js = Y.compile("напиши 1");
  assert.ok(!/python|perevod/i.test(js));
});

test("неоднозначности грамматики: цепочка сравнений запрещена", () => {
  fails("напиши 1 < 2 < 3", /цепочкой/);
  fails("напиши 1 == 1 == истина", /цепочкой/);
  assert.deepStrictEqual(r("напиши 1 < 2 и 2 < 3"), ["истина"]);
});

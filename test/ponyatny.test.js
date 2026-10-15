const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { run } = require("../src/ponyatny");

const r = (src, answers) => run(src, { ask: () => (answers || []).shift() });

test("вывод и арифметика", () => {
  assert.deepStrictEqual(r("напиши 2 + 3 * 4\nнапиши (2 + 3) * 4\nнапиши 7 / 2"), ["14", "20", "3,5"]);
});
test("переменные и строки", () => {
  assert.deepStrictEqual(r('пусть a = "мир"\na = "Привет, " + a\nнапиши a'), ["Привет, мир"]);
});
test("если / иначе если / иначе", () => {
  const src = "функция оценка(x)\nесли x > 10 то\nверни \"много\"\nиначе если x > 5 то\nверни \"средне\"\nиначе\nверни \"мало\"\nконец\nконец\nнапиши оценка(20), оценка(7), оценка(1)";
  assert.deepStrictEqual(r(src), ["много средне мало"]);
});
test("пока и стоп", () => {
  assert.deepStrictEqual(r("пусть i = 0\nпока истина\ni = i + 1\nесли i == 3 то\nстоп\nконец\nконец\nнапиши i"), ["3"]);
});
test("повторить N раз", () => {
  assert.deepStrictEqual(r("повторить 2 раз\nнапиши \"да\"\nконец"), ["да", "да"]);
});
test("списки", () => {
  assert.deepStrictEqual(r("пусть с = [1, 2]\nдобавь(с, 3)\nс[0] = 10\nнапиши с, длина(с), с[2]"), ["[10, 2, 3] 3 3"]);
});
test("рекурсия", () => {
  assert.deepStrictEqual(r("функция ф(н)\nесли н <= 1 то\nверни 1\nконец\nверни н * ф(н - 1)\nконец\nнапиши ф(5)"), ["120"]);
});
test("логика и комментарии", () => {
  assert.deepStrictEqual(r("# коммент\nнапиши истина и не ложь, 1 > 2 или 2 > 1 // ещё"), ["истина истина"]);
});
test("ввод", () => {
  assert.deepStrictEqual(r('пусть x = число(спроси("?"))\nнапиши x * 2', ["21"]), ["42"]);
});
test("понятные ошибки", () => {
  assert.throws(() => r("напиши у"), /Строка 1: не знаю, что такое «у»/);
  assert.throws(() => r("напиши 1 / 0"), /делить на ноль/);
  assert.throws(() => r("пока истина\nконец"), /слишком долго/);
  assert.throws(() => r("если 1 то\nнапиши 1"), /конец/);
});
test("пример из папки primery работает", () => {
  const out = r(fs.readFileSync(path.join(__dirname, "../primery/privet.pon"), "utf8"), ["Ваня"]);
  assert.strictEqual(out[0], "Привет, Ваня!");
  assert.ok(out.includes("7 × 10 = 70"));
  assert.ok(out.includes("Квадрат девяти: 81"));
});

const test = require("node:test");
const assert = require("node:assert");
const Y = require("../src/yadro");

const run = (src) => { const err = []; const out = Y.run(src, { writeErr: (s) => err.push(s) }); return { out, err }; };
const r = (src) => run(src).out;

test("шуточные слова работают как обычные команды", () => {
  const x = run("переменная x = 2\nнапечатай \"x =\", x\nвыведи на экран \"фраза\"\nкричи на систему \"громко\"\nшепни \"тихо\"\nспасите\n    паника \"всё плохо\"\nна случай беды как е\n    скажи миру \"поймали: \" + е\nв любом случае\n    пиши \"финал\"\nаминь");
  assert.deepStrictEqual(x.out, ["x = 2", "фраза", "поймали: всё плохо", "финал"]);
  assert.deepStrictEqual(x.err, ["громко", "[отладка] тихо"]);
});
test("ну всё, занавес, зуб даю, до посинения, хватит, проехали", () => {
  assert.deepStrictEqual(r("пиши 1\nну всё\nпиши 2"), ["1"]);
  assert.deepStrictEqual(r("пиши 1\nЗанавес\nпиши 2"), ["1"]);
  assert.deepStrictEqual(r("пиши 1\nя устал, я ухожу\nпиши 2"), ["1"]);
  assert.throws(() => r("зуб даю 2 * 2 == 5"), /проверка не прошла/);
  assert.deepStrictEqual(r("пусть i = 0\nдо посинения\n    i += 1\n    если i == 2 то\n        проехали\n    конец\n    если i > 3 то\n        хватит\n    конец\n    пиши i\nконец"), ["1", "3"]);
  assert.deepStrictEqual(r("кинь \"брошено\"".replace("кинь", "авось\n    кинь") + "\nесли всё сломалось как е\n    пиши е\nконец"), ["брошено"]);
});
test("формы слов: повелительное и неопределённое, падежи, ё и е", () => {
  assert.deepStrictEqual(r("повтори 2 раза\n    напечатать \"р\"\nвсё"), ["р", "р"]);
  assert.deepStrictEqual(r("для i с 1 по 3 шагом 1\n    печатай i\nконец"), ["1", "2", "3"]);
  assert.deepStrictEqual(r("для каждой б в \"аб\"\n    выводи б\nконец\nдля каждый ч среди [7]\n    покажи ч\nконец"), ["а", "б", "7"]);
  assert.deepStrictEqual(r("пускай н = 0\nпокуда н < 5\n    н += 1\n    ежели н == 2 то\n        хватит\n    конец\nконец\nпостоянная П = 3\nпиши н, П"), ["2 3"]);
  assert.deepStrictEqual(r("процедура удвой(x)\n    вернуть x * 2\nконец\nпиши удвой(4)"), ["8"]);
  assert.deepStrictEqual(r("пиши 1\nну все\nпиши 2"), ["1"]);
  assert.deepStrictEqual(r("пиши 1\nНУ ВСЁ\nпиши 2"), ["1"]);
});
test("старые программы с такими именами не ломаются", () => {
  assert.deepStrictEqual(r("пусть паника = 1\nпаника = 2\nпиши паника"), ["2"]);
  assert.deepStrictEqual(r("функция выведи(x)\n    верни x * 2\nконец\nпиши выведи(3)\nвыведи(4)"), ["6"]);
  assert.deepStrictEqual(r("пусть всё = 3\nпиши всё"), ["3"]);
  assert.deepStrictEqual(r("пусть с = 1\nдля i от с до 2\n    пиши i\nконец"), ["1", "2"]);
});

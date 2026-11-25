const test = require("node:test");
const assert = require("node:assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const Y = require("../src/yadro");
const STD = require("../src/std.js");
const CLI = path.join(__dirname, "..", "src", "cli.js");
const resolve = (p) => { const m = String(p).match(/^стд\/(.+)$/); return m && STD[m[1]] ? { id: "стд:" + m[1], name: p, source: STD[m[1]] } : null; };
const run = (src, io) => Y.run(src, Object.assign({ resolve }, io || {}));
function cli(src, input, env) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "v27-"));
  fs.writeFileSync(path.join(d, "п.pon"), src);
  const r = cp.spawnSync(process.execPath, [CLI, "запустить", "п.pon"], { cwd: d, input, encoding: "utf8", timeout: 20000, env: Object.assign({}, process.env, env || {}) });
  return { code: r.status, out: r.stdout, err: r.stderr, signal: r.signal };
}

test("калькулятор «Логарифмическая линейка 3000» работает целиком", () => {
  const src = fs.readFileSync(path.join(__dirname, "lineika-3000.pon"), "utf8");
  const input = ["2 + 2 * 2^10 - корень(144) + 5!", "синус(30) + косинус(60) + логарифм(8; 2)", "м+", "анс * пи + м", "рад", "синус(пи / 2)", "град", "м-", "мс", "история", "1 / 0", "лог(-1)", "2 ^ 3 ^ 2", "выход"].join("\n") + "\n";
  const r = cli(src, input);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, />> Ответ: 2158/);
  assert.match(r.out, />> Ответ: 4\n/);
  assert.match(r.out, /В память добавлено 4\. Теперь M = 4/);
  assert.match(r.out, />> Ответ: 16,5663706144/);
  assert.match(r.out, /Режим углов: РАДИАНЫ/);
  assert.match(r.out, /Память очищена/);
  assert.match(r.out, /   1\) 2 \+ 2 \* 2\^10 - корень\(144\) \+ 5! = 2158\n/);
  assert.match(r.out, /   4\) синус\(пи \/ 2\) = 1\n/);
  assert.match(r.out, /Деление на ноль! Вселенная чуть не схлопнулась/);
  assert.match(r.out, /Логарифм существует только для положительных чисел/);
  assert.match(r.out, />> Ответ: 512/);
  assert.match(r.out, /Калькулятор ушёл в спящий режим/);
});

test("конец ввода (Ctrl+D, «Отмена» в окне) завершает программу, а не зацикливает её", () => {
  const src = fs.readFileSync(path.join(__dirname, "lineika-3000.pon"), "utf8");
  const r = cli(src, "2+2\n");
  assert.equal(r.signal, null);
  assert.equal(r.code, 0);
  assert.match(r.out, />> Ответ: 4/);
  assert.match(r.err, /Ввод закончился/);
  let asked = 0;
  const lines = run("пока истина\n    пусть x = спроси(\"?\")\n    если x == \"\" то\n        дальше\n    конец\nконец", { ask: () => { asked++; return null; }, writeErr: () => {} });
  assert.equal(asked, 1);
  assert.deepStrictEqual(lines, []);
});

test("«для каждого номер, запись из нумеруй(…)» раскладывает пары", () => {
  assert.deepStrictEqual(run("для каждого н, з из нумеруй([\"а\", \"б\"])\n    пиши н, з\nконец\nдля каждого а, б из попарно([1, 2], [3, 4])\n    пиши а + б\nконец\nдля каждого н, з из [\"x\"]\n    пиши н, з\nконец"), ["0 а", "1 б", "4", "6", "0 x"]);
});

test("перенос строк: «\\», открытые скобки, операторы в начале и в конце строки", () => {
  const src = "пусть а = 1 + \\\n    2\nпусть б = [1,\n  2]\nпусть в1 = а\n    + сумма(б)\nпусть с = \"  Аб \"\n    .обрезать()\n    .маленькими()\nесли а > 0\n    и в1 > 0 то\n    пиши а, в1, с\nконец";
  assert.deepStrictEqual(run(src), ["3 6 аб"]);
  assert.deepStrictEqual(run("пусть x = 5\n-x"), []);
});

test("встроенные имена с маленькой или большой первой буквы: ошибка, пи, длина", () => {
  const src = "попробуй\n    брось ошибка(\"бах\")\nесли ошибка ошибка как е\n    пиши е\nконец\nпиши экземпляр(ошибка(\"x\"), Ошибка), пи == ПИ, Длина(\"абв\")\nПиши \"ок\"";
  assert.deepStrictEqual(run(src), ["бах", "истина истина 3", "ок"]);
  assert.throws(() => run("пусть Х = 1\nпиши х"), /не знаю, что такое «х»/);
});

test("авось_сработает детерминирован: ошибка глушится, «Штатный режим, расходимся», 42", () => {
  const src = "функция ф(н)\n    авось_сработает\n        если н > 0 то\n            брось \"упало\"\n        конец\n    конец\n    верни 1\nконец\nпиши ф(1)\nпиши ф(0)\nавось_сработает\n    пиши 1 / 0\nконец\nпиши \"дальше\"";
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(run(src), ["Штатный режим, расходимся", "42", "1", "Штатный режим, расходимся", "дальше"]);
  assert.deepStrictEqual(run("авось_сработает\n    выход(3)\nконец\nпиши \"после\""), []);
});

test("приложить_подорожник и сделать_вид_что_так_и_задумано", () => {
  assert.deepStrictEqual(run("пиши приложить_подорожник(1 / 0), приложить_подорожник(ничего), приложить_подорожник(\"а\"), приложить_подорожник(0)"), ["Да вроде работает Да вроде работает а 0"]);
  const ok = [];
  const lines = run("сделать_вид_что_так_и_задумано\n    брось \"сломалось\"\nконец\nпиши \"идём дальше\"\nсделать_вид_что_так_и_задумано()\nбрось \"совсем\"", { feature: (t) => ok.push(t) });
  assert.deepStrictEqual(ok, ["Строка 2: сломалось — Фича активирована", "Строка 6: совсем — Фича активирована"]);
  assert.ok(lines.includes("идём дальше"));
  const r = cli("сделать_вид_что_так_и_задумано()\nбрось \"бум\"", "");
  assert.equal(r.code, 0);
  assert.match(r.out, /бум — Фича активирована/);
});

test("интеграл … конец считает площадь под графиком", () => {
  assert.deepStrictEqual(run("интеграл х от 0 до ПИ\n    синус(х)\nконец\nпиши площадь\nинтеграл т от 0 до 2 шагов 100 как п\n    верни т * т\nконец\nпиши округли(п, 6)\nпиши интеграл(x => 3, 0, 2)"), ["2", "2,666667", "6"]);
  assert.throws(() => run("константа площадь = 1\nинтеграл х от 0 до 1\n    х\nконец"), /нельзя перезаписать/);
});

test("приколы из советских фильмов работают без случайностей", () => {
  const src = "памятник Г = 1\nпиши Г\nпиши короче_склифосовский(\"очень длинная история\", 8), брюки_превращаются(\"5\") + 1, брюки_превращаются(5), крылатые_качели([1, 2]), рэсси([\"а\", \"б\"], \"б\")\nдля каждого н из [1, 2, 3]\n    если н == 2 то\n        птичку_жалко\n    конец\n    пиши н\nконец\nы\nчтоб_никто_не_догадался\n    пиши \"тайна\"\nконец\nпиши электроник(x => x + 1, 1)\nцигель_цигель()\nну_погоди(60000)\nпопробуй\n    замуровали_демоны()\nесли ошибка как е\n    пиши е\nконец";
  const t0 = Date.now();
  assert.deepStrictEqual(run(src), ["1", "очень д… 6 5 [1, 2, 1] 1", "1", "Электроник сделал всё за Сыроежкина", "2", "Замуровали, демоны!"]);
  assert.ok(Date.now() - t0 < 5000);
  assert.throws(() => run("памятник Г = 1\nГ = 2"), /констант|нельзя/);
});

test("квантовый симулятор: Белл, Гровер, Фурье, Дойч — Йожа, измерение воспроизводимо", () => {
  const out = run("подключи \"стд/квант\"\nпусть б = состояние_белла()\nпиши б.состояние()\nпиши б.вероятности()\nпиши округли(гровер(4, 11).вероятности()[\"|1011⟩\"], 4)\nпусть ф = КвантовыйРегистр(2)\nф.паули_x(0)\nквантовое_фурье(ф)\nпиши ф.состояние()\nпиши дойч_йожа(3, x => 0), дойч_йожа(3, x => x % 2)\nпусть р = КвантовыйРегистр(1)\nр.поворот_y(0, ПИ / 3)\nпиши р.вероятность_единицы(0)\nпиши б.замеры(1000)\nпусть т = КвантовыйРегистр(3)\nт.паули_x(0).паули_x(1).тоффоли(0, 1, 2)\nпиши т.состояние()");
  assert.deepStrictEqual(out.slice(0, 7), ["0,7071|00⟩ + 0,7071|11⟩", "{\"|00⟩\": 0,5, \"|11⟩\": 0,5}", "0,9613", "0,5|00⟩ + 0,5i|01⟩ - 0,5|10⟩ - 0,5i|11⟩", "постоянная сбалансированная", "0,25", out[6]]);
  const m = out[6].match(/"\|00⟩": (\d+), "\|11⟩": (\d+)/);
  assert.ok(m && Number(m[1]) + Number(m[2]) === 1000 && Math.abs(Number(m[1]) - 500) < 60);
  assert.equal(out[7], "1|111⟩");
  assert.deepStrictEqual(run("подключи \"стд/квант\"\nпиши состояние_белла().замеры(100)"), run("подключи \"стд/квант\"\nпиши состояние_белла().замеры(100)"));
  assert.throws(() => run("подключи \"стд/квант\"\nКвантовыйРегистр(2).адамар(5)"), /Нет кубита с номером 5/);
});

test("переведённые библиотеки: куча, поиск, статистика, цвет, плавность, вектор, игра, текст", () => {
  const out = run("подключи \"стд/куча\"\nподключи \"стд/поиск\"\nподключи \"стд/статистика\"\nподключи \"стд/цвет\"\nподключи \"стд/плавность\"\nподключи \"стд/вектор\"\nподключи \"стд/игра\"\nподключи \"стд/текст\"\n" +
    "пусть к = []\nдля каждого х из [5, 1, 8, 3]\n    положи_в_кучу(к, х)\nконец\nпиши достань_из_кучи(к), достань_из_кучи(к), наименьшие(2, [4, 1, 3])\n" +
    "пиши место_слева([1, 2, 2, 3], 2), место_справа([1, 2, 2, 3], 2), найди_двоичным([1, 3, 5], 5)\n" +
    "пиши медиана([1, 2, 3, 4]), дисперсия([2, 4, 4, 4, 5, 5, 7, 9]), отклонение_генеральное([2, 4, 4, 4, 5, 5, 7, 9]), квантили([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])\n" +
    "пиши hsv_в_rgb(0.5, 1, 1), в_hex(1, 0.5, 0), смешай(\"#000000\", \"#ffffff\")\n" +
    "пиши плавно_квадрат(0.25), между(0, 100, 0.5)\n" +
    "пиши Вектор(3, 4).длина_вектора(), Вектор(1, 2).плюс(Вектор(3, 4))\n" +
    "пиши Спрайт(0, 0, 10, 10).касается(Спрайт(5, 5, 10, 10)), круги_касаются(0, 0, 1, 3, 0, 1)\n" +
    "пиши перенеси(\"раз два три четыре\", 9)");
  assert.deepStrictEqual(out, ["1 3 [1, 3]", "1 3 2", "2,5 4,5714285714 2 [2,75, 5,5, 8,25]", "[0, 1, 1] #ff8000 #808080", "0,125 50", "5 (4; 6)", "истина ложь", "[\"раз два\", \"три\", \"четыре\"]"]);
});

test("графика и игры: вызовы уходят в хост окна, в консоли — понятная ошибка", () => {
  const calls = [];
  const gfx = { call: (n, a) => { calls.push(n); if (n === "мышь") return { x: 1, y: 2, "нажата": false }; if (n === "клавиша") return true; return null; }, busy: () => true };
  const out = run("окно(\"Игра\", 320, 200)\nзалей(\"чёрный\")\nпрямоугольник(1, 2, 3, 4, \"красный\")\nпиши мышь()[\"y\"], клавиша(\"влево\")\nкаждый_кадр(дт => круг(1, 1, 1))\nпиши пересекаются(0, 0, 2, 2, 1, 1, 2, 2)", { gfx });
  assert.deepStrictEqual(out, ["2 истина", "истина"]);
  assert.deepStrictEqual(calls, ["окно", "залей", "прямоугольник", "мышь", "клавиша", "каждый_кадр"]);
  assert.throws(() => run("окно()"), /в консоли их нет/);
  const r = cli("пусть окно = 5\nпиши окно", "");
  assert.equal(r.out.trim(), "5");
});

test("версия 2.7.0", () => {
  assert.equal(Y.VERSION, "2.7.0");
  assert.equal(require("../package.json").version, "2.7.0");
  assert.match(cp.execFileSync(process.execPath, [CLI, "--version"], { encoding: "utf8" }), /2\.7\.0/);
});

test("сборка под iOS: проект Xcode без ключей в файлах", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "v27ios-"));
  fs.writeFileSync(path.join(d, "игра.pon"), "окно(\"Игра\", 100, 100)\nзалей(\"синий\")\nпусть имя = спроси(\"Имя?\")\nпиши \"Привет, \" + имя\n");
  const r = cp.spawnSync(process.execPath, [CLI, "собрать", "игра.pon", "--ios", "-o", "app", "--название", "Моя игра!", "--id", "ru.test.igra"], { cwd: d, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const app = path.join(d, "app");
  for (const f of ["project.yml", "Sources/App.swift", "www/index.html", "www/yadro.js", "www/grafika.js", "www/program.js", "sobrat-ios.sh", "ЛИЦЕНЗИИ.txt"]) assert.ok(fs.existsSync(path.join(app, f)), f);
  const yml = fs.readFileSync(path.join(app, "project.yml"), "utf8");
  assert.match(yml, /ru\.test\.igra/);
  assert.match(yml, /Моя игра!/);
  const sh = fs.readFileSync(path.join(app, "sobrat-ios.sh"), "utf8");
  assert.match(sh, /IOS_CERT_P12_BASE64/);
  assert.match(sh, /CODE_SIGNING_ALLOWED=NO/);
  assert.ok(fs.statSync(path.join(app, "sobrat-ios.sh")).mode & 0o100);
  const swift = fs.readFileSync(path.join(app, "Sources/App.swift"), "utf8");
  assert.match(swift, /WKWebView/);
  assert.match(swift, /runJavaScriptTextInputPanelWithPrompt/);
  const prog = fs.readFileSync(path.join(app, "www/program.js"), "utf8");
  assert.match(prog, /__ponyatnyMain/);
  new Function(prog);
});

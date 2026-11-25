const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const own = read("LICENSE");
const text = [
  "Понятный — © 2026 Иван Воронцов. Все права защищены.",
  "",
  own,
  "",
  "==== Сторонние компоненты ====",
  "",
  "acorn (разбор JavaScript в переводчике) — MIT License:",
  read("licenses/acorn-LICENSE.txt"),
  "",
  "Node.js (среда выполнения внутри ponyatny.exe и внутри программ, собранных командой «собрать») — MIT License и лицензии встроенных библиотек:",
  read("licenses/node-LICENSE.txt"),
  "",
  "Стандартная библиотека «стд/куча», «стд/поиск», «стд/статистика», «стд/цвет», «стд/текст» — перевод модулей heapq, bisect, statistics, colorsys и textwrap из Python 3.12 на «Понятный» (изменения: перевод на другой язык, русские имена). © 2001–2024 Python Software Foundation; All Rights Reserved. PSF License Agreement for Python:",
  read("licenses/python-PSF-LICENSE.txt"),
  "",
  "«стд/плавность» — перевод Easing Equations Роберта Пеннера на «Понятный» — BSD License:",
  read("licenses/penner-easing-BSD.txt"),
  "",
  "«стд/вектор» — перевод основных методов Victor.js на «Понятный» — MIT License:",
  read("licenses/victor-LICENSE.txt"),
].join("\n");
fs.writeFileSync(path.join(root, "src", "licenzii.js"), "module.exports = " + JSON.stringify(text) + ";\n");

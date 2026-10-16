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
].join("\n");
fs.writeFileSync(path.join(root, "src", "licenzii.js"), "module.exports = " + JSON.stringify(text) + ";\n");

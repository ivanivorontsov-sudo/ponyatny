"use strict";
// Нативная сборка: Понятный → «Низ» → машинный код x86-64 → ELF (Linux) или PE (Windows).
// Ни C, ни gcc не нужны: кодогенератор и сборщики файлов написаны здесь же, на JS.
const { translate, NativeError } = require("./kodogen");
const { compileNiz, NizError } = require("./niz");
const { writeElf, writePe } = require("./obraz");

const RT_FILES = ["core", "ops", "obj", "methods", "builtins", "extras", "os"];
let RT = null;
function runtimeSources() {
  if (RT) return RT;
  try { RT = require("./rt-sborka.js"); } catch (e) {
    const fs = require("fs"), path = require("path");
    RT = {};
    for (const f of RT_FILES) RT[f] = fs.readFileSync(path.join(__dirname, "rt", f + ".niz"), "utf8");
  }
  return RT;
}

function buildNative(program, opts) {
  opts = opts || {};
  const target = opts.target || (process.platform === "win32" ? "windows" : "linux");
  if (target !== "linux" && target !== "windows") throw new NativeError("неизвестная цель «" + target + "»: можно windows или linux");
  const niz = translate(program, opts);
  if (opts.dumpNiz) opts.dumpNiz(niz);
  const rt = runtimeSources();
  const sources = RT_FILES.map((f) => ({ src: rt[f], file: "rt/" + f + ".niz" })).concat([{ src: niz, file: "программа.niz" }]);
  const img = compileNiz(sources, { platform: target });
  return target === "windows" ? writePe(img, { gui: !!opts.gui }) : writeElf(img);
}

module.exports = { buildNative, translate, NativeError, NizError, RT_FILES };

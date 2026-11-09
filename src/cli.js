#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const Y = require("./yadro");
const VERSION = "2.5.0";
const MAGIC = Buffer.from("PONYATNY", "ascii");

if (process.platform === "win32") { try { require("child_process").execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "chcp.com"), ["65001"], { stdio: "ignore", windowsHide: true }); } catch (e) {} }

function isSea() { try { return require("node:sea").isSea(); } catch (e) { return false; } }

function readPayload(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size < 16) return null;
    const tail = Buffer.alloc(16);
    fs.readSync(fd, tail, 0, 16, size - 16);
    if (!tail.subarray(8).equals(MAGIC)) return null;
    const len = Number(tail.readBigUInt64LE(0));
    if (len <= 0 || len > size - 16) return null;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - 16 - len);
    return { code: buf.toString("utf8"), baseSize: size - 16 - len };
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function runPayload(code) {
  new Function("require", "process", "Buffer", code)(require, process, Buffer);
}

function out(s) { process.stdout.write(s + "\n"); }
function errOut(s) { process.stderr.write(s + "\n"); }

function resolver(baseFile) {
  return (p, from) => {
    const sm = String(p).match(/^(?:стд|std)\/([^\/\\]+?)(?:\.pon)?$/i);
    if (sm) { const STD = require("./std.js"); const name = sm[1].toLowerCase(); if (!Object.prototype.hasOwnProperty.call(STD, name)) return null; return { id: "стд:" + name, name: "стд/" + name + ".pon", source: STD[name] }; }
    const dir = path.dirname(from && fs.existsSync(from) ? from : baseFile);
    let full = path.resolve(dir, p);
    if (!/\.pon$/i.test(full)) full += ".pon";
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return { id: full, name: full, source: fs.readFileSync(full, "utf8") };
  };
}

function readSource(file) {
  if (!file) { errOut("Не указан файл программы. Пример: ponyatny запустить программа.pon"); process.exit(2); }
  if (!fs.existsSync(file)) { errOut("Файл «" + file + "» не найден."); process.exit(2); }
  return fs.readFileSync(file, "utf8");
}

function warnOut(w) {
  errOut("Предупреждение. " + (w.file ? "Файл «" + path.basename(w.file) + "», строка " : "Строка ") + w.line + (w.col ? ", столбец " + w.col : "") + ": " + w.text);
}

function compileFile(file, flags) {
  const src = readSource(file);
  try {
    return Y.compile(src, { file: path.resolve(file), resolve: resolver(path.resolve(file)), warn: warnOut, ascii: !!(flags && flags.ascii) });
  } catch (e) {
    if (e instanceof Y.CompileError) { errOut("Ошибка. " + e.message.replace(path.resolve(file), path.basename(file))); process.exit(1); }
    throw e;
  }
}

function parseFlags(args) {
  const flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--выход" || a === "--out") flags.out = args[++i];
    else if (a === "--в" || a === "--to" || a === "-в") flags.to = args[++i];
    else if (a === "--js") flags.js = true;
    else if (a === "--ascii" || a === "--латиница") flags.ascii = true;
    else if (a === "--основа" || a === "--base") flags.base = args[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

function help() {
  out("Понятный " + VERSION + " — язык программирования на русском.");
  out("");
  out("Команды:");
  out("  ponyatny запустить программа.pon        выполнить программу");
  out("  ponyatny собрать программа.pon [-o имя]  сделать программу .exe (на Windows) или исполняемый файл (на Linux)");
  out("  ponyatny компилировать программа.pon     получить программа.js (JavaScript для Node.js)");
  out("  ponyatny проверить программа.pon         только проверить ошибки");
  out("  ponyatny перевести файл --в язык         по желанию: перевести в python, javascript, csharp или понятный (из .py и .js)");
  out("                                           --латиница: русские имена переменных записать латиницей");
  out("  ponyatny компилировать … --ascii          имена в JavaScript только латиницей");
  out("  ponyatny версия");
  out("  ponyatny лицензии                       авторские права и лицензии сторонних компонентов");
  out("");
  out("Можно и коротко: ponyatny программа.pon");
}

function sameFile(a, b) {
  const ra = path.resolve(a), rb = path.resolve(b);
  if (ra === rb || (process.platform === "win32" && ra.toLowerCase() === rb.toLowerCase())) return true;
  try { const x = fs.statSync(ra), y = fs.statSync(rb); return x.ino === y.ino && x.dev === y.dev && x.ino !== 0; } catch (e) { return false; }
}

function safeTarget(target, protect) {
  if (!target) { errOut("Не указано имя выходного файла."); process.exit(2); }
  for (const [p, what] of protect) {
    if (p && sameFile(target, p)) { errOut("Ошибка. Выходной файл «" + target + "» совпадает с " + what + ". Укажи другое имя через -o."); process.exit(2); }
  }
  try { if (fs.existsSync(target) && fs.statSync(target).isDirectory()) { errOut("Ошибка. «" + target + "» — это папка, а не файл. Укажи имя файла через -o."); process.exit(2); } } catch (e) {}
  return target;
}

function cmdRun(file) {
  const js = compileFile(file);
  runPayload(Y.standalone(js));
}

function cmdCompile(file, flags) {
  const js = Y.standalone(compileFile(file, flags));
  const target = safeTarget(flags.out || file.replace(/\.pon$/i, "") + ".js", [[file, "файлом программы"], [process.execPath, "самим компилятором"]]);
  fs.writeFileSync(target, "#!/usr/bin/env node\n" + js, "utf8");
  out("Готово: " + target);
}

function cmdBuild(file, flags) {
  const js = Y.standalone(compileFile(file, flags));
  let base = flags.base;
  if (!base) {
    if (isSea()) base = process.execPath;
    else {
      const guess = path.join(__dirname, "..", "dist", process.platform === "win32" ? "ponyatny.exe" : "ponyatny-linux");
      if (fs.existsSync(guess)) base = guess;
    }
  }
  if (!base || !fs.existsSync(base)) { errOut("Не найден исполняемый файл компилятора, на основе которого собирается программа. Запусти собранный ponyatny.exe или укажи --основа путь."); process.exit(2); }
  const winBase = /\.exe$/i.test(base);
  let target = flags.out || file.replace(/\.pon$/i, "");
  if (winBase && !/\.exe$/i.test(target)) target += ".exe";
  if (!winBase && !flags.out && !/\.pon$/i.test(file)) target += ".bin";
  safeTarget(target, [[file, "файлом программы"], [base, "компилятором, на основе которого идёт сборка"], [process.execPath, "самим компилятором"]]);
  const own = readPayload(base);
  const baseBuf = fs.readFileSync(base);
  const body = own ? baseBuf.subarray(0, own.baseSize) : baseBuf;
  const payload = Buffer.from(js, "utf8");
  const tail = Buffer.alloc(16);
  tail.writeBigUInt64LE(BigInt(payload.length), 0);
  MAGIC.copy(tail, 8);
  fs.writeFileSync(target, Buffer.concat([body, payload, tail]));
  try { fs.chmodSync(target, 0o755); } catch (e) {}
  fs.writeFileSync(target + ".ЛИЦЕНЗИИ.txt", require("./licenzii.js"));
  out("Готово: " + target + " (" + Math.round((body.length + payload.length) / 1048576) + " МБ)");
}

function cmdCheck(file, flags) {
  compileFile(file, flags);
  out("Ошибок нет: " + file);
}

function cmdTranslate(file, flags) {
  const src = readSource(file);
  const to = String(flags.to || "").toLowerCase();
  if (!to) { errOut("Укажи язык: --в python, --в javascript, --в csharp или --в понятный"); process.exit(2); }
  let res, ext;
  try {
    if (["понятный", "ponyatny", "pon"].includes(to)) {
      const from = /\.py$/i.test(file) ? "python" : /\.(m?js|cjs)$/i.test(file) ? "javascript" : null;
      if (!from) { errOut("Переводить в «Понятный» можно файлы .py и .js"); process.exit(2); }
      res = require("./perevod-v").translateToPon(src, from);
      ext = ".pon";
    } else {
      res = require("./perevod-iz").translate(src, to, { file: path.resolve(file), resolve: resolver(path.resolve(file)), latin: !!flags.ascii });
      ext = { python: ".py", py: ".py", javascript: ".js", js: ".js", csharp: ".cs", "c#": ".cs", cs: ".cs" }[to] || ".txt";
    }
  } catch (e) {
    errOut("Ошибка. " + e.message);
    process.exit(1);
  }
  const target = safeTarget(flags.out || file.replace(/\.[^.\\/]+$/, "") + (ext === path.extname(file) ? ".перевод" : "") + ext, [[file, "исходным файлом"]]);
  fs.writeFileSync(target, res.code, "utf8");
  out("Готово: " + target);
  if (res.notes.length) {
    out("Примечания (" + res.notes.length + ") — эти места переведены не точно, проверьте их:");
    for (const n of res.notes) out("  " + (n.line ? "строка " + n.line + ": " : "") + n.text);
  }
}

function main(argv) {
  if (isSea()) {
    const own = readPayload(process.execPath);
    if (own) { runPayload(own.code); return; }
  }
  const { flags, rest } = parseFlags(argv);
  const [cmd, file] = rest;
  const c = (cmd || "").toLowerCase();
  if (!c || ["помощь", "help", "-h", "--help", "справка"].includes(c)) return help();
  if (["версия", "version", "-v", "--version"].includes(c)) return out("Понятный " + VERSION);
  if (["запустить", "run", "выполнить"].includes(c)) return cmdRun(file);
  if (["собрать", "build"].includes(c)) return cmdBuild(file, flags);
  if (["компилировать", "compile", "скомпилировать"].includes(c)) return cmdCompile(file, flags);
  if (["проверить", "check"].includes(c)) return cmdCheck(file, flags);
  if (["лицензии", "лицензия", "licenses", "license"].includes(c)) return out(require("./licenzii.js"));
  if (["перевести", "translate"].includes(c)) return cmdTranslate(file, flags);
  if (/\.pon$/i.test(cmd) || fs.existsSync(cmd)) return cmdRun(cmd);
  const hint = Y.suggest(cmd, ["запустить", "собрать", "компилировать", "проверить", "перевести", "версия", "помощь", "лицензии"]);
  errOut("Не знаю команду «" + cmd + "»." + hint + " Список команд: ponyatny помощь");
  process.exit(2);
}

main(process.argv.slice(2));

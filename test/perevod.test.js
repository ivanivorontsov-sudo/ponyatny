const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const Y = require("../src/yadro");
const IZ = require("../src/perevod-iz");
const V = require("../src/perevod-v");

const dir = path.join(__dirname, "../primery");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const runPon = (src) => Y.run(src).join("\n") + "\n";
const tmp = (name, text) => { const f = path.join(os.tmpdir(), "pon-" + process.pid + "-" + name); fs.writeFileSync(f, text); return f; };
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const dotnet = ["dotnet", path.join(os.homedir(), "dotnet/dotnet")].find((d) => { try { return spawnSync(d, ["--version"]).status === 0; } catch (e) { return false; } });
const DETERMINISTIC = ["faktorial.pon", "klass.pon", "slovar.pon"];

for (const f of DETERMINISTIC) {
  test("Понятный → JavaScript даёт тот же вывод: " + f, () => {
    const { code } = IZ.translate(read(f), "javascript");
    const out = execFileSync(process.execPath, [tmp(f + ".js", code)]).toString();
    assert.strictEqual(out, runPon(read(f)));
  });
  test("Понятный → Python даёт тот же вывод: " + f, { skip: !hasPython }, () => {
    const { code } = IZ.translate(read(f), "python");
    const out = execFileSync("python3", [tmp(f + ".py", code)], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } }).toString();
    assert.strictEqual(out, runPon(read(f)));
  });
  test("туда и обратно через Python: " + f, { skip: !hasPython }, () => {
    const py = IZ.translate(read(f), "python").code;
    const back = V.translateToPon(py, "python");
    assert.ok(!back.checkError, back.checkError);
    assert.strictEqual(runPon(back.code), runPon(read(f)));
  });
  test("туда и обратно через JavaScript: " + f, () => {
    const js = IZ.translate(read(f), "javascript").code;
    const back = V.translateToPon(js, "javascript");
    assert.ok(!back.checkError, back.checkError);
    assert.strictEqual(runPon(back.code), runPon(read(f)));
  });
}

test("Python → Понятный даёт тот же вывод", { skip: !hasPython }, () => {
  const src = fs.readFileSync(path.join(__dirname, "perevod/primer.py"), "utf8");
  const r = V.translateToPon(src, "python");
  assert.ok(!r.checkError, r.checkError);
  const expected = execFileSync("python3", [path.join(__dirname, "perevod/primer.py")]).toString();
  assert.strictEqual(runPon(r.code), expected);
});
test("JavaScript → Понятный даёт тот же вывод", () => {
  const src = fs.readFileSync(path.join(__dirname, "perevod/primer.js"), "utf8");
  const r = V.translateToPon(src, "javascript");
  assert.ok(!r.checkError, r.checkError);
  const expected = execFileSync(process.execPath, [path.join(__dirname, "perevod/primer.js")]).toString();
  assert.strictEqual(runPon(r.code), expected);
});
test("неточные места помечаются примечаниями", () => {
  const r1 = IZ.translate("пусть навсегда x = [1]\nнапиши x", "python");
  assert.ok(r1.notes.some((n) => /навсегда/.test(n.text)));
  assert.match(r1.code, /# ПРИМЕЧАНИЕ \(строка 1\)/);
  const r2 = V.translateToPon("import os\nx = {1, 2}\nprint(x)\nwith open('a') as f:\n    pass\n", "python");
  assert.match(r2.code, /пусть x = множество\(\[1, 2\]\)/);
  assert.ok(r2.notes.some((n) => /with/.test(n.text)));
  const r3 = V.translateToPon("let a = 5; a >>= 1; console.log(a >> 1);", "javascript");
  assert.match(r3.code, /a = сдвиг_вправо\(a, 1\)/);
  assert.match(r3.code, /пиши сдвиг_вправо\(a, 1\)/);
  const r4 = V.translateToPon("x = 1\ndel x\n", "python");
  assert.match(r4.code, /# ПРИМЕЧАНИЕ/);
});
test("ошибки переводчика по-русски", () => {
  assert.throws(() => IZ.translate("напиши 1", "cobol"), /не знаю язык «cobol»/);
  assert.throws(() => V.translateToPon("def f(:\n", "python"), /Строка 1/);
  assert.throws(() => V.translateToPon("let = ;", "javascript"), /JavaScript не разобрался/);
  assert.throws(() => IZ.translate("напиши хх", "python"), /не знаю, что такое «хх»/);
});
test("Понятный → C# собирается и даёт тот же вывод", { skip: !dotnet || !process.env.PON_CSHARP ? "C# проверяется при PON_CSHARP=1 и установленном dotnet" : false, timeout: 240000 }, () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "pon-cs-"));
  fs.writeFileSync(path.join(proj, "t.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net" + execFileSync(dotnet, ["--version"]).toString().split(".")[0] + ".0</TargetFramework><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>");
  const src = read("faktorial.pon").replace(/: число|-> число/g, "") + "\n" + read("slovar.pon").replace(/^# .*$/gm, "");
  fs.writeFileSync(path.join(proj, "Program.cs"), IZ.translate(src, "csharp").code);
  const out = execFileSync(dotnet, ["run", "--project", proj], { env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } }).toString();
  assert.strictEqual(out.replace(/\r/g, ""), runPon(src));
});
test("перевод новых конструкций 2.4 в Python и JavaScript", () => {
  const IZ = require("../src/perevod-iz.js");
  const cp = require("child_process"), os = require("os");
  const src = "пусть а, б = 1, 2\nа, б = б, а\nделай\n    а += 1\nконец пока а < 5\nперечисление Ц\n    А, Б\nконец\nубедись а > 0\nпиши а, б, Ц[\"Б\"]\n";
  const js = IZ.translate(src, "javascript").code;
  const f = path.join(os.tmpdir(), "pon-iz-" + process.pid + ".js");
  fs.writeFileSync(f, js);
  const r = cp.spawnSync(process.execPath, [f], { encoding: "utf8" });
  fs.unlinkSync(f);
  assert.strictEqual(r.stdout, "5 1 1\n");
  assert.match(IZ.translate(src, "python").code, /while True:\n\s+а \+= 1\n\s+if not \(а < 5\):\n\s+break/);
});
test("универсальные конструкции Python и JavaScript переводятся в «Понятный» 2.4 и работают так же", () => {
  const norm = (t) => t.replace(/\bTrue\b|\btrue\b/g, "истина").replace(/\bFalse\b|\bfalse\b/g, "ложь").replace(/'/g, "\"");
  for (const [file, from, cmd] of [["universal.py", "python", "python3"], ["universal.js", "javascript", process.execPath]]) {
    const src = fs.readFileSync(path.join(__dirname, "perevod", file), "utf8");
    const r = V.translateToPon(src, from);
    assert.ok(!r.checkError, file + ": " + r.checkError + "\n" + r.code);
    assert.ok(!/«[A-Za-z]+(Pattern|Expression)» не переводится/.test(r.code), r.code);
    const err = [];
    const pon = Y.run(r.code, { writeErr: (s) => err.push(s) }).join("\n") + "\n";
    assert.deepStrictEqual(err, ["в поток ошибок"]);
    const nat = spawnSync(cmd, [path.join(__dirname, "perevod", file)], { encoding: "utf8" });
    if (nat.error) continue;
    assert.strictEqual(pon, norm(nat.stdout), file);
  }
});

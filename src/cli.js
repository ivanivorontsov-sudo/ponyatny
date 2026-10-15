#!/usr/bin/env node
const fs = require("fs");
const { run } = require("./ponyatny");

function askSync(q) {
  process.stdout.write(q + " ");
  const buf = Buffer.alloc(1);
  let s = "";
  for (;;) {
    let n = 0;
    try { n = fs.readSync(0, buf, 0, 1, null); } catch (e) { if (e.code === "EAGAIN") continue; if (e.code === "EOF") break; throw e; }
    if (n === 0) break;
    const ch = buf.toString("utf8", 0, 1);
    if (ch === "\n") break;
    s += buf.toString("latin1", 0, 1);
  }
  return Buffer.from(s, "latin1").toString("utf8").replace(/\r$/, "");
}

const file = process.argv[2];
if (!file) {
  console.log("Как запускать: node src/cli.js программа.pon");
  process.exit(1);
}
try {
  run(fs.readFileSync(file, "utf8"), { write: (s) => console.log(s), ask: askSync });
} catch (e) {
  console.error("Ошибка. " + e.message);
  process.exit(1);
}

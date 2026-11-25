"use strict";
// «Низ» — внутренний низкоуровневый язык нативного бэкенда «Понятного».
// Одно значение = 64-битное слово. На нём написана среда выполнения (src/nativ/rt/*.niz),
// в него же переводится программа на «Понятном». Компилятор «Низа» сам выдаёт машинный код x86-64.
const { Asm, R } = require("./asm");

class NizError extends Error {}
const f64bits = (x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b.readBigInt64LE(); };

// ---------- лексер ----------
function lex(src, file) {
  const toks = [];
  let i = 0, line = 1;
  const err = (m) => { throw new NizError((file || "низ") + ":" + line + ": " + m); };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (/[A-Za-z_@]/.test(c)) { let j = i + 1; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; toks.push({ t: "id", v: src.slice(i, j), line }); i = j; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      if (c === "0" && /[xX]/.test(src[i + 1])) { j = i + 2; while (/[0-9a-fA-F_]/.test(src[j])) j++; toks.push({ t: "num", v: BigInt(src.slice(i, j).replace(/_/g, "")), line }); i = j; continue; }
      while (/[0-9_]/.test(src[j])) j++;
      let isF = false;
      if (src[j] === "." && /[0-9]/.test(src[j + 1])) { isF = true; j++; while (/[0-9]/.test(src[j])) j++; }
      if (/[eE]/.test(src[j]) && /[-+0-9]/.test(src[j + 1])) { isF = true; j++; if (/[-+]/.test(src[j])) j++; while (/[0-9]/.test(src[j])) j++; }
      const text = src.slice(i, j).replace(/_/g, "");
      toks.push({ t: "num", v: isF ? f64bits(Number(text)) : BigInt(text), f: isF, line }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { const n = src[j + 1]; s += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "0" ? "\0" : n === "e" ? "\x1b" : n; j += 2; }
        else { if (src[j] === "\n") line++; s += src[j]; j++; }
      }
      if (c === "'") { const b = Buffer.from(s, "utf8"); toks.push({ t: "num", v: BigInt(b[0] || 0), line }); }
      else toks.push({ t: "str", v: s, line });
      i = j + 1; continue;
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if ([">>>", "..."].includes(three)) { toks.push({ t: "op", v: three, line }); i += 3; continue; }
    if (["->", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "+=", "-=", "*=", "|=", "&=", "^="].includes(two)) { toks.push({ t: "op", v: two, line }); i += 2; continue; }
    if ("+-*/%<>=!~&|^(){}[];,.:".includes(c)) { toks.push({ t: "op", v: c, line }); i++; continue; }
    err("непонятный символ «" + c + "»");
  }
  toks.push({ t: "eof", v: "", line });
  for (const t of toks) t.line = (file || "низ") + ":" + t.line;
  return toks;
}

// ---------- парсер ----------
function parseNiz(src, file, plat) {
  const toks = lex(src, file);
  let p = 0;
  const peek = (k = 0) => toks[p + k];
  const err = (m, t) => { throw new NizError((file || "низ") + ":" + (t || peek()).line + ": " + m); };
  const is = (v, k = 0) => (peek(k).t === "op" || peek(k).t === "id") && peek(k).v === v;
  const accept = (v) => { if (is(v)) { p++; return true; } return false; };
  const expect = (v) => { if (!accept(v)) err("ожидалось «" + v + "», а встретилось «" + peek().v + "»"); };
  const ident = () => { if (peek().t !== "id") err("ожидалось имя"); return toks[p++].v; };
  const items = [];
  const PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, ">>>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  function primary() {
    const t = peek();
    if (t.t === "num") { p++; return { k: "num", v: t.v, f: t.f, line: t.line }; }
    if (t.t === "str") { p++; return { k: "str", v: t.v, line: t.line }; }
    if (accept("(")) { const e = expr(); expect(")"); return e; }
    if (t.t === "id") {
      p++;
      if (is("(")) { p++; const args = []; if (!is(")")) { do { args.push(expr()); } while (accept(",")); } expect(")"); return { k: "call", name: t.v, args, line: t.line }; }
      return { k: "name", name: t.v, line: t.line };
    }
    err("ожидалось выражение, а встретилось «" + t.v + "»");
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (accept("->")) { const f = ident(); e = { k: "field", obj: e, name: f, line: e.line }; continue; }
      if (accept("[")) { const i = expr(); expect("]"); e = { k: "index", obj: e, index: i, line: e.line }; continue; }
      return e;
    }
  }
  function unary() {
    const t = peek();
    if (t.t === "op" && ["-", "!", "~"].includes(t.v)) { p++; return { k: "un", op: t.v, e: unary(), line: t.line }; }
    if (t.t === "op" && t.v === "&") { p++; return { k: "addr", name: ident(), line: t.line }; }
    return postfix();
  }
  function binary(minP) {
    let l = unary();
    for (;;) {
      const t = peek();
      const pr = t.t === "op" ? PREC[t.v] : undefined;
      if (!pr || pr < minP) return l;
      p++;
      const r = binary(pr + 1);
      l = { k: "bin", op: t.v, l, r, line: t.line };
    }
  }
  function expr() { return binary(1); }
  function block() { expect("{"); const b = []; while (!accept("}")) b.push(stmt()); return b; }
  function stmt() {
    const t = peek();
    if (accept("var")) {
      const name = ident();
      if (accept("[")) { const n = expr(); expect("]"); expect(";"); return { k: "vararr", name, n, line: t.line }; }
      const v = accept("=") ? expr() : null; expect(";"); return { k: "var", name, value: v, line: t.line };
    }
    if (accept("if")) {
      expect("("); const c = expr(); expect(")");
      const then = block(); let other = null;
      if (accept("else")) other = is("if") ? [stmt()] : block();
      return { k: "if", cond: c, then, other, line: t.line };
    }
    if (accept("while")) { expect("("); const c = expr(); expect(")"); return { k: "while", cond: c, body: block(), line: t.line }; }
    if (accept("for")) {
      expect("("); const init = is(";") ? null : simple(); expect(";"); const c = is(";") ? null : expr(); expect(";"); const step = is(")") ? null : simple(); expect(")");
      return { k: "for", init, cond: c, step, body: block(), line: t.line };
    }
    if (accept("return")) { const v = is(";") ? null : expr(); expect(";"); return { k: "return", value: v, line: t.line }; }
    if (accept("break")) { expect(";"); return { k: "break", line: t.line }; }
    if (accept("continue")) { expect(";"); return { k: "continue", line: t.line }; }
    if (accept("try")) { const body = block(); expect("catch"); return { k: "try", body, handler: block(), line: t.line }; }
    if (is("{")) return { k: "block", body: block(), line: t.line };
    const s = simple(); expect(";"); return s;
  }
  function simple() {
    const t = peek();
    if (accept("var")) { const name = ident(); expect("="); return { k: "var", name, value: expr(), line: t.line }; }
    const e = expr();
    const op = peek();
    if (op.t === "op" && ["=", "+=", "-=", "*=", "|=", "&=", "^="].includes(op.v)) {
      p++;
      let v = expr();
      if (op.v !== "=") v = { k: "bin", op: op.v[0], l: e, r: v, line: op.line };
      if (!["name", "field", "index"].includes(e.k)) err("слева от «=» должно быть имя, поле или элемент");
      return { k: "assign", target: e, value: v, line: t.line };
    }
    return { k: "expr", e, line: t.line };
  }
  while (peek().t !== "eof") {
    let only = null;
    if (peek().t === "id" && peek().v[0] === "@") { only = toks[p++].v.slice(1); }
    const t = peek();
    let item;
    if (accept("const")) { const name = ident(); expect("="); item = { k: "const", name, value: expr(), line: t.line }; expect(";"); }
    else if (accept("global")) {
      const name = ident();
      if (accept("[")) { const n = expr(); expect("]"); expect(";"); item = { k: "global", name, n, line: t.line }; }
      else { const v = accept("=") ? expr() : null; expect(";"); item = { k: "global", name, value: v, line: t.line }; }
    } else if (accept("struct")) {
      const name = ident(); let base = null; if (accept(":")) base = ident();
      expect("{"); const fields = []; if (!is("}")) { do { fields.push(ident()); } while (accept(",")); } expect("}");
      item = { k: "struct", name, base, fields, line: t.line };
    } else if (is("fn") || (is("inline") && is("fn", 1))) {
      const inl = accept("inline"); expect("fn");
      const name = ident(); expect("("); const params = []; if (!is(")")) { do { params.push(ident()); } while (accept(",")); } expect(")");
      item = { k: "fn", name, params, body: block(), line: t.line, inline: inl };
    } else if (accept("extern")) {
      const name = ident(); expect("("); const kinds = []; let vararg = false;
      if (!is(")")) { do { if (accept("...")) { vararg = true; break; } kinds.push(ident()); } while (accept(",")); }
      expect(")"); let ret = "i"; if (accept("->")) ret = ident();
      let lib = "c", cname = name; if (accept("from")) { lib = peek().v; p++; } if (accept("as")) { cname = peek().v; p++; }
      expect(";");
      item = { k: "extern", name, cname, kinds, vararg, ret, lib, line: t.line };
    } else err("ожидалось const, global, struct, fn или extern");
    if (!only || only === plat) items.push(item);
  }
  return items;
}

// ---------- генерация кода ----------
const SYSV_INT = [R.rdi, R.rsi, R.rdx, R.rcx, R.r8, R.r9];
const WIN_INT = [R.rcx, R.rdx, R.r8, R.r9];

function compileNiz(sources, opts) {
  const plat = opts.platform; // "linux" | "windows"
  const items = [];
  for (const s of sources) items.push(...parseNiz(s.src, s.file, plat));
  const consts = new Map([["WINDOWS", plat === "windows" ? 1n : 0n], ["LINUX", plat === "linux" ? 1n : 0n]]);
  const fields = new Map(), structs = new Map();
  const globals = new Map(); // name -> {off, arr}
  const fns = new Map(), externs = new Map();
  const data = [];
  const strs = new Map();
  const dataAlloc = (n, al = 8) => { while (data.length % al) data.push(0); const off = data.length; for (let i = 0; i < n; i++) data.push(0); return off; };
  const strData = (s) => { if (strs.has(s)) return strs.get(s); const b = Buffer.from(s, "utf8"); const off = data.length; for (const x of b) data.push(x); data.push(0); strs.set(s, off); return off; };
  const err = (m, n) => { throw new NizError((n && n.line ? n.line : "низ") + ": " + m); };
  function cfold(e) {
    switch (e.k) {
      case "num": return BigInt.asIntN(64, e.v);
      case "name": if (consts.has(e.name)) return consts.get(e.name); return null;
      case "un": { if (e.op === "-" && e.e.k === "num" && e.e.f) return BigInt.asIntN(64, e.e.v ^ (1n << 63n)); const v = cfold(e.e); if (v == null) return null; return BigInt.asIntN(64, e.op === "-" ? -v : e.op === "~" ? ~v : v ? 0n : 1n); }
      case "bin": {
        const a = cfold(e.l), b = cfold(e.r); if (a == null || b == null) return null;
        switch (e.op) {
          case "+": return BigInt.asIntN(64, a + b); case "-": return BigInt.asIntN(64, a - b); case "*": return BigInt.asIntN(64, a * b);
          case "/": return b ? a / b : null; case "%": return b ? a % b : null;
          case "<<": return BigInt.asIntN(64, a << b); case ">>": return a >> b; case ">>>": return BigInt.asIntN(64, BigInt.asUintN(64, a) >> b);
          case "&": return a & b; case "|": return a | b; case "^": return a ^ b;
          case "==": return a === b ? 1n : 0n; case "!=": return a !== b ? 1n : 0n; case "<": return a < b ? 1n : 0n; case "<=": return a <= b ? 1n : 0n; case ">": return a > b ? 1n : 0n; case ">=": return a >= b ? 1n : 0n;
          case "&&": return a && b ? 1n : 0n; case "||": return a || b ? 1n : 0n;
        }
        return null;
      }
      case "field": return null;
      case "call": if (e.name === "sizeof" && e.args[0] && e.args[0].k === "name" && structs.has(e.args[0].name)) return BigInt(structs.get(e.args[0].name).length * 8); return null;
    }
    return null;
  }
  for (const it of items) {
    if (it.k === "const") { const v = cfold(it.value); if (v == null) err("константа «" + it.name + "» должна вычисляться при компиляции", it); consts.set(it.name, v); }
    else if (it.k === "struct") {
      const fl = (it.base ? (structs.get(it.base) || err("нет структуры " + it.base, it)) : []).concat(it.fields);
      structs.set(it.name, fl);
      fl.forEach((f, i) => { if (fields.has(f) && fields.get(f) !== i * 8) err("поле «" + f + "» уже есть с другим смещением", it); fields.set(f, i * 8); });
      consts.set(it.name + "_size", BigInt(fl.length * 8));
    }
  }
  const imports = [];
  for (const it of items) {
    if (it.k === "global") {
      if (it.n) { const n = Number(cfold(it.n)); globals.set(it.name, { off: dataAlloc(8 * n), arr: true }); }
      else { const off = dataAlloc(8); globals.set(it.name, { off, arr: false }); if (it.value) { const v = cfold(it.value); if (v == null) err("начальное значение глобальной должно быть константой", it); let x = BigInt.asUintN(64, v); for (let i = 0; i < 8; i++) { data[off + i] = Number(x & 255n); x >>= 8n; } } }
    } else if (it.k === "fn") { if (fns.has(it.name)) err("функция «" + it.name + "» уже есть", it); fns.set(it.name, { node: it, label: null }); }
    else if (it.k === "extern") { it.imp = null; externs.set(it.name, it); }
  }
  const a = new Asm();
  const impOf = (x) => { if (x.imp == null) { x.imp = imports.length; imports.push({ lib: x.lib, name: x.cname }); } return x.imp; };
  for (const f of fns.values()) f.label = a.label();
  const used = new Set();

  // ----- функция -----
  let F = null; // текущая функция: {locals: Map, frame, params}
  function fnCode(node) {
    F = { scopes: [new Map()], frame: 0, loops: [], tries: 0, node };
    node.params.forEach((pn, i) => F.scopes[0].set(pn, { off: 16 + 8 * (node.params.length - 1 - i) }));
    a.bind(fns.get(node.name).label);
    a.push(R.rbp); a.mov(R.rbp, R.rsp);
    // sub rsp, imm32 (заполним позже)
    a.rex(1, 0, 0, R.rsp); a.byte(0x81); a.byte(0xEC); const frameAt = a.pos; a.d32(0);
    stmts(node.body);
    a.movImm(R.rax, 0);
    epilogue();
    let fr = (F.frame + 15) & ~15;
    a.b[frameAt] = fr & 255; a.b[frameAt + 1] = (fr >> 8) & 255; a.b[frameAt + 2] = (fr >> 16) & 255; a.b[frameAt + 3] = (fr >>> 24) & 255;
  }
  function epilogue() { a.mov(R.rsp, R.rbp); a.pop(R.rbp); a.ret(); }
  function allocSlot(n = 1) { F.frame += 8 * n; return -F.frame; }
  function lookup(name) { for (let i = F.scopes.length - 1; i >= 0; i--) if (F.scopes[i].has(name)) return F.scopes[i].get(name); return null; }
  // оператор, после которого код в этом блоке недостижим (return или «if» с константой, где выбранная ветка кончается return)
  function ends(s) {
    if (!s) return false;
    if (s.k === "return") return true;
    if (s.k === "if") { const c = cfold(s.cond); if (c != null) { const br = c ? s.then : s.other; return !!br && br.length > 0 && ends(br[br.length - 1]); } }
    return false;
  }
  function stmts(list) { F.scopes.push(new Map()); for (const s of list) { stmt(s); if (ends(s)) break; } F.scopes.pop(); }
  const G = (name) => ({ data: globals.get(name).off });
  // снятие обработчиков исключений при выходе из try через return/break
  function unwindTries(toDepth) {
    for (let d = F.tries; d > toDepth; d--) { const rec = F.tryRecs[d - 1]; a.load(R.rcx, R.rbp, rec); a.storeRip({ data: globals.get("rt_handler").off }, R.rcx); }
  }
  function stmt(s) {
    switch (s.k) {
      case "var": {
        const off = allocSlot();
        if (s.value) { expr(s.value); a.store(R.rbp, off, R.rax); } else { a.movImm(R.rax, 0); a.store(R.rbp, off, R.rax); }
        F.scopes[F.scopes.length - 1].set(s.name, { off });
        return;
      }
      case "vararr": {
        const n = Number(cfold(s.n));
        const base = allocSlot(n); const off = allocSlot();
        a.lea(R.rax, R.rbp, base); a.store(R.rbp, off, R.rax);
        F.scopes[F.scopes.length - 1].set(s.name, { off });
        return;
      }
      case "assign": {
        const t = s.target;
        if (t.k === "name") {
          const l = lookup(t.name);
          expr(s.value);
          if (l) a.store(R.rbp, l.off, R.rax);
          else if (globals.has(t.name) && !globals.get(t.name).arr) a.storeRip(G(t.name), R.rax);
          else err("нельзя присвоить «" + t.name + "»", s);
          return;
        }
        if (t.k === "field") {
          const off = fields.get(t.name); if (off == null) err("нет поля «" + t.name + "»", s);
          expr(t.obj); a.push(R.rax); expr(s.value); a.pop(R.rcx); a.store(R.rcx, off, R.rax); return;
        }
        if (t.k === "index") {
          expr(t.obj); a.push(R.rax); expr(t.index); a.push(R.rax); expr(s.value); a.pop(R.rdx); a.pop(R.rcx); a.storeIdx(R.rcx, R.rdx, 0, R.rax); return;
        }
        return;
      }
      case "expr": expr(s.e); return;
      case "block": stmts(s.body); return;
      case "if": {
        const c = cfold(s.cond);
        if (c != null) { if (c) stmts(s.then); else if (s.other) stmts(s.other); return; }
        const Lelse = a.label(), Lend = a.label();
        condJump(s.cond, Lelse);
        stmts(s.then);
        if (s.other) { a.jmp(Lend); a.bind(Lelse); stmts(s.other); a.bind(Lend); } else a.bind(Lelse);
        return;
      }
      case "while": case "for": {
        F.scopes.push(new Map());
        if (s.k === "for" && s.init) stmt(s.init);
        const Ltop = a.label(), Lcont = a.label(), Lend = a.label();
        a.bind(Ltop);
        if (s.cond) { const c = cfold(s.cond); if (c == null) condJump(s.cond, Lend); else if (!c) a.jmp(Lend); }
        F.loops.push({ cont: Lcont, brk: Lend, tries: F.tries });
        stmts(s.body);
        F.loops.pop();
        a.bind(Lcont);
        if (s.k === "for" && s.step) stmt(s.step);
        a.jmp(Ltop);
        a.bind(Lend);
        F.scopes.pop();
        return;
      }
      case "break": case "continue": {
        const l = F.loops[F.loops.length - 1]; if (!l) err("break/continue вне цикла", s);
        unwindTries(l.tries);
        a.jmp(s.k === "break" ? l.brk : l.cont); return;
      }
      case "return":
        if (s.value) expr(s.value); else a.movImm(R.rax, 0);
        if (F.tries) { a.push(R.rax); unwindTries(0); a.pop(R.rax); }
        epilogue(); return;
      case "try": {
        // запись: [prev, rsp, rbp, resume]
        const rec = allocSlot(4);
        const Lcatch = a.label(), Lend = a.label();
        const H = { data: globals.get("rt_handler").off };
        a.leaRip(R.rax, { label: Lcatch }); a.store(R.rbp, rec + 24, R.rax);
        a.store(R.rbp, rec + 16, R.rbp); a.store(R.rbp, rec + 8, R.rsp);
        a.loadRip(R.rax, H); a.store(R.rbp, rec, R.rax);
        a.lea(R.rax, R.rbp, rec); a.storeRip(H, R.rax);
        F.tryRecs = F.tryRecs || []; F.tryRecs[F.tries] = rec; F.tries++;
        stmts(s.body);
        F.tries--;
        a.load(R.rax, R.rbp, rec); a.storeRip(H, R.rax);
        a.jmp(Lend);
        a.bind(Lcatch);
        stmts(s.handler);
        a.bind(Lend);
        return;
      }
    }
    err("неизвестная команда " + s.k, s);
  }
  const CMP = { "==": ["e", "ne"], "!=": ["ne", "e"], "<": ["l", "ge"], "<=": ["le", "g"], ">": ["g", "le"], ">=": ["ge", "l"] };
  function isSimple(e) { if (e.k === "num" && e.v >= -0x80000000n && e.v < 0x80000000n) return true; if (e.k === "name" && lookup(e.name)) return true; const c = cfold(e); return c != null && c >= -0x80000000n && c < 0x80000000n; }
  function loadSimple(reg, e) { const c = cfold(e); if (c != null) { a.movImm(reg, c); return; } a.load(reg, R.rbp, lookup(e.name).off); }
  // вычислить l в rax, r в rcx
  function pairEval(l, r) { if (isSimple(r)) { expr(l); loadSimple(R.rcx, r); } else { expr(l); a.push(R.rax); expr(r); a.mov(R.rcx, R.rax); a.pop(R.rax); } }
  function condJump(e, Lfalse) {
    if (e.k === "bin" && CMP[e.op]) { pairEval(e.l, e.r); a.alu("cmp", R.rax, R.rcx); a.jcc(CMP[e.op][1], Lfalse); return; }
    if (e.k === "bin" && e.op === "&&") { condJump(e.l, Lfalse); condJump(e.r, Lfalse); return; }
    if (e.k === "bin" && e.op === "||") { const Ltrue = a.label(), Lnext = a.label(); condJump(e.l, Lnext); a.jmp(Ltrue); a.bind(Lnext); condJump(e.r, Lfalse); a.bind(Ltrue); return; }
    if (e.k === "un" && e.op === "!") { const Lt = a.label(); condJump(e.e, Lt); a.jmp(Lfalse); a.bind(Lt); return; }
    expr(e); a.alu("test", R.rax, R.rax); a.jcc("e", Lfalse);
  }
  function args2(e) { pairEval(e.args[0], e.args[1]); }
  const FCMP = { flt: ["b", 0], fle: ["be", 0], fgt: ["a", 1], fge: ["ae", 1], feq: ["e", 2], fne: ["ne", 3] };
  function intrinsic(e) {
    const n = e.name, A = e.args;
    const need = (k) => { if (A.length !== k) err("«" + n + "» ждёт " + k + " значений", e); };
    switch (n) {
      case "ld": need(1); expr(A[0]); a.load(R.rax, R.rax, 0); return true;
      case "ld8": need(1); expr(A[0]); a.load8(R.rax, R.rax, 0); return true;
      case "ld16": need(1); expr(A[0]); a.load16(R.rax, R.rax, 0); return true;
      case "ld32": need(1); expr(A[0]); a.load32(R.rax, R.rax, 0); return true;
      case "lds32": need(1); expr(A[0]); a.load32s(R.rax, R.rax, 0); return true;
      case "st": case "st8": case "st16": case "st32": need(2); args2(e); if (n === "st") a.store(R.rax, 0, R.rcx); else if (n === "st8") a.store8(R.rax, 0, R.rcx); else if (n === "st16") a.store16(R.rax, 0, R.rcx); else a.store32(R.rax, 0, R.rcx); return true;
      case "fadd": case "fsub": case "fmul": case "fdiv": need(2); args2(e); a.movqXR(0, R.rax); a.movqXR(1, R.rcx); a[n.slice(1) + "sd"](0, 1); a.movqRX(R.rax, 0); return true;
      case "fsqrt": need(1); expr(A[0]); a.movqXR(0, R.rax); a.sqrtsd(0, 0); a.movqRX(R.rax, 0); return true;
      case "ffloor": case "fceil": case "ftrunc": need(1); expr(A[0]); a.movqXR(0, R.rax); a.roundsd(0, 0, n === "ffloor" ? 9 : n === "fceil" ? 10 : 11); a.movqRX(R.rax, 0); return true;
      case "i2f": need(1); expr(A[0]); a.cvtsi2sd(0, R.rax); a.movqRX(R.rax, 0); return true;
      case "f2i": need(1); expr(A[0]); a.movqXR(0, R.rax); a.cvttsd2si(R.rax, 0); return true;
      case "f2f32": need(1); expr(A[0]); a.movqXR(0, R.rax); a.cvtsd2ss(0, 0); a.movdRX(R.rax, 0); return true;
      case "f32tof": need(1); expr(A[0]); a.movdXR(0, R.rax); a.cvtss2sd(0, 0); a.movqRX(R.rax, 0); return true;
      case "flt": case "fle": case "fgt": case "fge": case "feq": case "fne": {
        need(2); args2(e);
        const [cc, mode] = FCMP[n];
        if (mode === 0) { a.movqXR(0, R.rcx); a.movqXR(1, R.rax); a.ucomisd(0, 1); a.setcc(cc === "b" ? "a" : "ae", R.rax); return true; }
        a.movqXR(0, R.rax); a.movqXR(1, R.rcx); a.ucomisd(0, 1);
        if (mode === 1) { a.setcc(cc, R.rax); return true; }
        // feq: ZF=1 и PF=0; fne: ZF=0 или PF=1
        a.setcc(mode === 2 ? "e" : "ne", R.rax); a.setcc(mode === 2 ? "np" : "p", R.rcx);
        a.alu(mode === 2 ? "and" : "or", R.rax, R.rcx); return true;
      }
      case "getsp": a.mov(R.rax, R.rsp); return true;
      case "getbp": a.mov(R.rax, R.rbp); return true;
      case "sizeof": return false;
      case "throw_unwind": {
        const H = { data: globals.get("rt_handler").off };
        a.loadRip(R.rax, H); a.load(R.rcx, R.rax, 0); a.storeRip(H, R.rcx);
        a.load(R.rsp, R.rax, 8); a.load(R.rbp, R.rax, 16); a.load(R.rax, R.rax, 24); a.jmpR(R.rax); return true;
      }
      case "run_on_stack": need(2); args2(e); a.mov(R.rsp, R.rax); a.callR(R.rcx); return true;
      case "callptr": {
        for (let i = 1; i < A.length; i++) { expr(A[i]); a.push(R.rax); }
        expr(A[0]); a.callR(R.rax); if (A.length > 1) a.aluImm("add", R.rsp, 8 * (A.length - 1)); return true;
      }
      case "ccall": {
        // ccall(указатель, "i,f->i", аргументы...)
        if (A.length < 2 || A[1].k !== "str") err("ccall(указатель, \"сигнатура\", ...)", e);
        const [ps, ret] = A[1].v.split("->");
        const kinds = ps.trim() ? ps.split(",").map((x) => x.trim()) : [];
        if (kinds.length !== A.length - 2) err("ccall: число значений не совпадает с сигнатурой", e);
        cCall({ kinds, ret: (ret || "i").trim(), vararg: false }, A.slice(2), () => { expr(A[0]); a.mov(R.r11, R.rax); }, () => a.callR(R.r11));
        return true;
      }
    }
    return false;
  }
  // вызов функции по соглашению C (SysV или Win64)
  function cCall(sig, args, pre, doCall) {
    const n = args.length;
    sig = { kinds: sig.kinds.slice(), ret: sig.ret, vararg: sig.vararg };
    args = args.map((x, i) => { if (x.k === "call" && x.name === "F" && x.args.length === 1) { sig.kinds[i] = "f"; return x.args[0]; } return x; });
    for (let i = 0; i < n; i++) if (!sig.kinds[i]) sig.kinds[i] = "i";
    for (const x of args) { expr(x); a.push(R.rax); }
    if (pre) pre();
    const at = (i) => 8 * (n - 1 - i);
    a.mov(R.rbx, R.rsp);
    a.aluImm("and", R.rsp, -16);
    const kind = (i) => sig.kinds[i] || "i";
    const isF = (k) => k === "f" || k === "f32";
    if (plat === "windows") {
      const S = Math.max(0, n - 4);
      const space = (32 + 8 * S + 15) & ~15;
      a.aluImm("sub", R.rsp, space);
      for (let i = 4; i < n; i++) { a.load(R.rax, R.rbx, at(i)); if (kind(i) === "f32") { a.movqXR(0, R.rax); a.cvtsd2ss(0, 0); a.movdRX(R.rax, 0); } a.store(R.rsp, 32 + 8 * (i - 4), R.rax); }
      for (let i = 0; i < Math.min(4, n); i++) {
        const k = kind(i);
        if (isF(k)) { a.load(R.rax, R.rbx, at(i)); a.movqXR(i, R.rax); if (k === "f32") a.cvtsd2ss(i, i); if (sig.vararg) a.load(WIN_INT[i], R.rbx, at(i)); }
        else a.load(WIN_INT[i], R.rbx, at(i));
      }
    } else {
      let ni = 0, nf = 0; const stack = [], regs = [];
      for (let i = 0; i < n; i++) { const k = kind(i); if (isF(k)) { if (nf < 8) regs.push({ i, x: nf++, k }); else stack.push(i); } else { if (ni < 6) regs.push({ i, r: SYSV_INT[ni++] }); else stack.push(i); } }
      if (stack.length & 1) a.aluImm("sub", R.rsp, 8);
      for (let j = stack.length - 1; j >= 0; j--) { const i = stack[j]; a.load(R.rax, R.rbx, at(i)); if (kind(i) === "f32") { a.movqXR(0, R.rax); a.cvtsd2ss(0, 0); a.movdRX(R.rax, 0); } a.push(R.rax); }
      for (const g of regs) if (g.x != null) { a.load(R.rax, R.rbx, at(g.i)); a.movqXR(g.x, R.rax); if (g.k === "f32") a.cvtsd2ss(g.x, g.x); }
      for (const g of regs) if (g.r != null) a.load(g.r, R.rbx, at(g.i));
      a.movImm(R.rax, nf);
    }
    doCall();
    a.mov(R.rsp, R.rbx);
    if (n) a.aluImm("add", R.rsp, 8 * n);
    switch (sig.ret) {
      case "f": a.movqRX(R.rax, 0); break;
      case "f32": a.cvtss2sd(0, 0); a.movqRX(R.rax, 0); break;
      case "i32": a.movsxd(R.rax, R.rax); break;
      case "u32": a.mov32(R.rax, R.rax); break;
      case "u8": a.rex(1, 0, 0, 0); a.bytes([0x0F, 0xB6, 0xC0]); break;
      case "u16": a.rex(1, 0, 0, 0); a.bytes([0x0F, 0xB7, 0xC0]); break;
      case "v": a.movImm(R.rax, 0); break;
    }
  }
  function expr(e) {
    const c = cfold(e);
    if (c != null) { a.movImm(R.rax, c); return; }
    switch (e.k) {
      case "str": a.leaRip(R.rax, { data: strData(e.v) }); return;
      case "name": {
        const l = lookup(e.name);
        if (l) { a.load(R.rax, R.rbp, l.off); return; }
        if (globals.has(e.name)) { const g = globals.get(e.name); if (g.arr) a.leaRip(R.rax, G(e.name)); else a.loadRip(R.rax, G(e.name)); return; }
        if (fns.has(e.name)) { used.add(e.name); a.leaRip(R.rax, { label: fns.get(e.name).label }); return; }
        if (externs.has(e.name)) { a.loadRip(R.rax, { imp: impOf(externs.get(e.name)) }); return; }
        err("неизвестное имя «" + e.name + "»", e);
      }
      case "addr": {
        if (globals.has(e.name)) { a.leaRip(R.rax, G(e.name)); return; }
        if (fns.has(e.name)) { used.add(e.name); a.leaRip(R.rax, { label: fns.get(e.name).label }); return; }
        err("адрес можно взять только у глобальной или функции", e);
      }
      case "field": { const off = fields.get(e.name); if (off == null) err("нет поля «" + e.name + "»", e); expr(e.obj); a.load(R.rax, R.rax, off); return; }
      case "index": {
        const ci = cfold(e.index);
        if (ci != null && ci * 8n < 0x7fffffffn && ci >= 0n) { expr(e.obj); a.load(R.rax, R.rax, Number(ci) * 8); return; }
        pairEval(e.obj, e.index); a.loadIdx(R.rax, R.rax, R.rcx, 0); return;
      }
      case "un":
        expr(e.e);
        if (e.op === "-") a.neg(R.rax); else if (e.op === "~") a.not(R.rax); else { a.alu("test", R.rax, R.rax); a.setcc("e", R.rax); }
        return;
      case "bin": {
        const op = e.op;
        if (op === "&&" || op === "||") { const Lf = a.label(), Le = a.label(); condJump(e, Lf); a.movImm(R.rax, 1); a.jmp(Le); a.bind(Lf); a.movImm(R.rax, 0); a.bind(Le); return; }
        pairEval(e.l, e.r);
        switch (op) {
          case "+": a.alu("add", R.rax, R.rcx); return;
          case "-": a.alu("sub", R.rax, R.rcx); return;
          case "*": a.imul(R.rax, R.rcx); return;
          case "&": a.alu("and", R.rax, R.rcx); return;
          case "|": a.alu("or", R.rax, R.rcx); return;
          case "^": a.alu("xor", R.rax, R.rcx); return;
          case "/": case "%": a.cqo(); a.idiv(R.rcx); if (op === "%") a.mov(R.rax, R.rdx); return;
          case "<<": a.shiftCl("shl", R.rax); return;
          case ">>": a.shiftCl("sar", R.rax); return;
          case ">>>": a.shiftCl("shr", R.rax); return;
        }
        if (CMP[op]) { a.alu("cmp", R.rax, R.rcx); a.setcc(CMP[op][0], R.rax); return; }
        err("неизвестная операция " + op, e);
      }
      case "call": {
        if (intrinsic(e)) return;
        if (fns.has(e.name)) {
          const f = fns.get(e.name);
          if (f.node.params.length !== e.args.length) err("«" + e.name + "» ждёт " + f.node.params.length + " значений, а передано " + e.args.length, e);
          if (f.node.inline && f.node.body.length === 1 && f.node.body[0].k === "return" && f.node.body[0].value) {
            const sc = new Map();
            f.node.params.forEach((pn, i) => {
              const arg = e.args[i];
              if (arg.k === "name" && lookup(arg.name)) { sc.set(pn, lookup(arg.name)); return; }
              const off = allocSlot(); expr(arg); a.store(R.rbp, off, R.rax); sc.set(pn, { off });
            });
            const saved = F.scopes; F.scopes = [sc];
            try { expr(f.node.body[0].value); } finally { F.scopes = saved; }
            return;
          }
          used.add(e.name);
          for (const x of e.args) { expr(x); a.push(R.rax); }
          a.call(f.label);
          if (e.args.length) a.aluImm("add", R.rsp, 8 * e.args.length);
          return;
        }
        if (externs.has(e.name)) {
          const x = externs.get(e.name);
          if (!x.vararg && x.kinds.length !== e.args.length) err("«" + e.name + "» ждёт " + x.kinds.length + " значений", e);
          cCall(x, e.args, null, () => a.callRip({ imp: impOf(x) }));
          return;
        }
        err("неизвестная функция «" + e.name + "»", e);
      }
    }
    err("неизвестное выражение " + e.k, e);
  }
  // ---- точка входа ----
  const entry = a.pos;
  if (plat === "linux") {
    // _start → __libc_start_main(main_c, argc, argv, 0, 0, rdx, rsp)
    const lsm = imports.length; imports.push({ lib: "c", name: "__libc_start_main" });
    const Lmain = a.label();
    a.bytes([0x31, 0xED]); // xor ebp, ebp
    a.mov(R.r9, R.rdx); a.pop(R.rsi); a.mov(R.rdx, R.rsp); a.aluImm("and", R.rsp, -16); a.push(R.rax); a.push(R.rsp);
    a.bytes([0x45, 0x31, 0xC0]); a.bytes([0x31, 0xC9]); // xor r8d,r8d ; xor ecx,ecx
    a.leaRip(R.rdi, { label: Lmain });
    a.callRip({ imp: lsm });
    a.byte(0xF4);
    a.bind(Lmain);
    a.push(R.rbx); a.push(R.rbp); a.push(R.r12);
    a.push(R.rdi); a.push(R.rsi);
    if (!fns.has("rt_entry")) err("нет функции rt_entry");
    a.call(fns.get("rt_entry").label); a.aluImm("add", R.rsp, 16);
    a.pop(R.r12); a.pop(R.rbp); a.pop(R.rbx); a.ret();
  } else {
    a.aluImm("sub", R.rsp, 40); a.movImm(R.rax, 0); a.push(R.rax); a.push(R.rax);
    a.call(fns.get("rt_entry").label); a.aluImm("add", R.rsp, 56); a.ret();
  }
  used.add("rt_entry");
  // компилируем только достижимые функции
  const done = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const name of [...used]) if (!done.has(name)) { done.add(name); fnCode(fns.get(name).node); progress = true; }
  }
  const ext = a.resolve();
  // убрать неиспользуемые импорты нельзя без перенумерации — оставляем все
  return { text: a.b, data: Buffer.from(data), ext, imports, entry, bss: 0 };
}
module.exports = { compileNiz, parseNiz, NizError };

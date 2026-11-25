"use strict";
// Перевод программы Понятного (дерево разбора из yadro.js) в текст на «Низе».
// Каждое значение — 64-битное слово (NaN-упаковка, см. rt/core.niz).
const { B: BUILTIN_FN, NO: BUILTIN_NO } = require("./vstroennye");

const TYPES = ["число", "строка", "логическое", "список", "словарь", "функция", "ничего", "любое", "целое", "множество"];
const OPS = { "+": "rt_plus", "-": "rt_minus", "*": "rt_mul", "/": "rt_div", "%": "rt_mod", "^": "rt_pow", "==": "rt_eq", "!=": "rt_ne", "<": "rt_lt", ">": "rt_gt", "<=": "rt_le", ">=": "rt_ge", "в": "rt_has" };
const ASSIGN_OPS = { "+=": "rt_plus", "-=": "rt_minus", "*=": "rt_mul", "/=": "rt_div", "%=": "rt_mod" };

class NativeError extends Error {
  constructor(msg, node) { super(msg); this.line = node && node.line; this.col = node && node.col; this.file = node && node.file; this.pureMessage = msg; }
}

function numLit(v) {
  const b = Buffer.alloc(8); b.writeDoubleLE(v);
  return "0x" + b.readBigUInt64LE().toString(16);
}
function cStr(s) {
  return "\"" + s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\0/g, "\\0") + "\"";
}

function translate(program, opts) {
  opts = opts || {};
  let uid = 0;
  const fail = (msg, n) => { throw new NativeError(msg, n); };
  const unsupported = (what, n) => fail(what + " — пока не поддерживается в нативной сборке (--нативно). Соберите без --нативно.", n);

  // ---------------- разбор областей видимости ----------------
  const globals = [];
  const ctxs = [];
  const newCtx = (kind, parent, name) => { const c = { id: ++uid, kind, parent, name, caps: [], capIdx: new Map(), thisCap: false, fins: [], loops: [] }; ctxs.push(c); return c; };
  const ownsThis = (c) => c.kind === "method" || c.kind === "init" || c.kind === "struct";
  const mkScope = (parent, ctx, global) => ({ vars: new Map(), parent, ctx, global: !!global });
  const declare = (sc, name, extra) => {
    const b = { id: ++uid, name, ctx: sc.ctx, global: sc.global, boxed: false, assigned: false, ...(extra || {}) };
    if (b.global) b.gi = globals.push(b) - 1;
    sc.vars.set(name, b);
    return b;
  };
  const addCap = (c, b) => { if (!c.capIdx.has(b)) { c.capIdx.set(b, c.caps.length); c.caps.push(b); } };
  const lookup = (sc, name) => { for (let s = sc; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name); return null; };
  const ref = (sc, name) => {
    const b = lookup(sc, name);
    if (!b) return null;
    if (!b.global && b.ctx !== sc.ctx) {
      b.boxed = true;
      for (let c = sc.ctx; c && c !== b.ctx; c = c.parent) addCap(c, b);
    }
    return b;
  };
  const refThis = (sc, n) => {
    let c = sc.ctx;
    while (c && !ownsThis(c)) { c.thisCap = true; c = c.parent; }
    if (!c) fail("«это» можно использовать только внутри класса", n);
  };
  const typeRef = (sc, t) => (t && !TYPES.includes(t) ? (ref(sc, t) || (t === "Ошибка" ? "builtinErr" : null)) : null);

  const shareSeen = new Set();
  const cloneAst = (x) => Array.isArray(x) ? x.map(cloneAst) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith("__")).map(([k, v]) => [k, cloneAst(v)])) : x;
  const root = mkScope(null, newCtx("main", null, "программа"), true);
  for (const g of program.globals || []) declare(root, g);

  function hoist(list, sc) {
    for (const s of list) {
      if (s.k === "func") s.__b = declare(sc, s.name, { isFunc: true, node: s });
      if (s.k === "class" || s.k === "struct") s.__b = declare(sc, s.name, { isClass: true });
      if (s.k === "iface") s.__b = declare(sc, s.name);
    }
  }
  function rBody(list, sc) { hoist(list, sc); for (const s of list) rStmt(s, sc); }
  function rBlock(list, sc) { const s2 = mkScope(sc, sc.ctx); rBody(list || [], s2); }
  function rFunc(f, sc, kind, name) {
    const c = newCtx(kind, sc.ctx, name);
    f.__ctx = c;
    const fs = mkScope(sc, c);
    for (const q of f.params || []) {
      if (q.def) rExpr(q.def, fs);
      q.__b = declare(fs, q.name);
      if (q.type) q.__tb = typeRef(fs, q.type);
    }
    if (f.ret) f.__rb = typeRef(fs, f.ret);
    if (f.async) unsupported("асинхронные функции («асинхронная»)", f);
    rBody(f.body || [], fs);
    return c;
  }
  function rStmt(s, sc) {
    switch (s.k) {
      case "let":
        if (s.kind === "lazy") unsupported("ленивые переменные («лениво»)", s);
        rExpr(s.value, sc);
        if (s.type) s.__tb = typeRef(sc, s.type);
        if (s.kind === "global") { s.__b = lookup(root, s.name) || declare(root, s.name); s.__b.assigned = true; }
        else s.__b = declare(sc, s.name);
        return;
      case "multilet": rExpr(s.value, sc); s.__bs = s.names.map((n) => declare(sc, n)); return;
      case "multiassign": rExpr(s.value, sc); s.parts.forEach((p) => rAssignTarget(p, sc)); return;
      case "dowhile": rBlock(s.body, sc); rExpr(s.cond, sc); return;
      case "assert": rExpr(s.cond, sc); if (s.msg) rExpr(s.msg, sc); return;
      case "enum": s.items.forEach((it) => it.value && rExpr(it.value, sc)); s.__b = declare(sc, s.name); return;
      case "iface": return;
      case "assign": rExpr(s.value, sc); rAssignTarget(s, sc); return;
      case "print": s.items.forEach((e) => rExpr(e, sc)); return;
      case "expr": rExpr(s.expr, sc); return;
      case "pass": case "break": case "continue": return;
      case "avos": case "feature": case "quiet": rBlock(s.body, sc); return;
      case "integral":
        rExpr(s.fn, sc); rExpr(s.from, sc); rExpr(s.to, sc); if (s.steps) rExpr(s.steps, sc); if (s.step) rExpr(s.step, sc);
        if (s.declare) s.__b = declare(sc, s.target);
        else { s.__b = ref(sc, s.target); if (!s.__b) fail("неизвестное имя «" + s.target + "»", s); s.__b.assigned = true; }
        return;
      case "if": rExpr(s.cond, sc); rBlock(s.then, sc); if (s.otherwise) rBlock(s.otherwise, sc); return;
      case "while": rExpr(s.cond, sc); rBlock(s.body, sc); return;
      case "repeat": rExpr(s.count, sc); rBlock(s.body, sc); return;
      case "foreach": {
        rExpr(s.list, sc);
        const s2 = mkScope(sc, sc.ctx);
        s.__b = declare(s2, s.name); if (s.name2) s.__b2 = declare(s2, s.name2);
        rBody(s.body, s2);
        return;
      }
      case "forrange": {
        rExpr(s.from, sc); rExpr(s.to, sc); if (s.step) rExpr(s.step, sc);
        const s2 = mkScope(sc, sc.ctx);
        s.__b = declare(s2, s.name);
        rBody(s.body, s2);
        return;
      }
      case "func": rFunc(s, sc, "func", s.name); return;
      case "return": if (s.value) rExpr(s.value, sc); return;
      case "throw": rExpr(s.value, sc); return;
      case "try": {
        rBlock(s.body, sc);
        const hs = s.handlers || (s.handler ? [{ type: null, errName: s.errName, body: s.handler }] : []);
        s.__hs = hs;
        for (const h of hs) {
          const s2 = mkScope(sc, sc.ctx);
          if (h.type) h.__tb = typeRef(sc, h.type);
          if (h.errName) h.__b = declare(s2, h.errName);
          rBody(h.body, s2);
        }
        if (s.fin) rBlock(s.fin, sc);
        return;
      }
      case "switch": {
        rExpr(s.subject, sc);
        for (const c of s.cases) {
          const s2 = mkScope(sc, sc.ctx);
          if (c.bind) c.__b = declare(s2, c.bind);
          (c.values || []).forEach((v) => rExpr(v, s2));
          if (c.guard) rExpr(c.guard, s2);
          rBlock(c.body, s2);
        }
        if (s.def) rBlock(s.def, sc);
        return;
      }
      case "class": rClass(s, sc); return;
      case "struct": {
        const c = newCtx("struct", sc.ctx, s.name);
        s.__ctx = c;
        const fs = mkScope(sc, c);
        for (const q of s.params) { if (q.def) rExpr(q.def, fs); q.__b = declare(fs, q.name); if (q.type) q.__tb = typeRef(fs, q.type); }
        return;
      }
      case "with": {
        rExpr(s.value, sc);
        const s2 = mkScope(sc, sc.ctx);
        s.__b = declare(s2, s.name);
        rBody(s.body, s2);
        return;
      }
      case "module": {
        if (s.share && shareSeen.has(s.share)) {
          s.__dup = true;
          if (s.alias) s.__b = declare(sc, s.alias);
          if (s.names) s.__bs = s.names.map((n) => declare(sc, n.as));
          return;
        }
        if (s.share) shareSeen.add(s.share);
        s.body = cloneAst(s.body);
        const c = newCtx("module", sc.ctx, "модуль");
        s.__ctx = c;
        const ms = mkScope(sc, c);
        rBody(s.body, ms);
        s.__exp = (s.exports || []).map((n) => { const b = ref(ms, n); if (!b) fail("модуль не объявляет «" + n + "»", s); return [n, b]; });
        if (s.alias) s.__b = declare(sc, s.alias);
        if (s.names) s.__bs = s.names.map((n) => declare(sc, n.as));
        return;
      }
      case "label": case "goto": unsupported("метки и «перейди к»", s); return;
      case "thread": unsupported("потоки («поток»)", s); return;
    }
    fail("не умею переводить конструкцию «" + s.k + "» в машинный код", s);
  }
  function rAssignTarget(s, sc) {
    const t = s.target;
    if (t.k === "name") {
      const b = ref(sc, t.name);
      if (!b) fail("неизвестное имя «" + t.name + "»", t);
      b.assigned = true; t.__b = b;
      if (s.checkType) s.__tb = typeRef(sc, s.checkType);
      return;
    }
    if (t.k === "deref") unsupported("ссылки («ссылка на», «*»)", t);
    rExpr(t.obj, sc);
    if (t.k === "index") rExpr(t.index, sc);
  }
  function rClass(s, sc) {
    if (s.parent) s.__pb = ref(sc, s.parent) || (s.parent === "Ошибка" ? "builtinErr" : null);
    s.__ifb = (s.ifaces || []).map((n) => ref(sc, n));
    const cs = mkScope(sc, sc.ctx);
    // поля экземпляра вычисляются в функции-инициализаторе с «это»
    const inst = (s.fields || []).filter((f) => !f.static);
    if (inst.length) {
      const c = newCtx("init", sc.ctx, s.name);
      s.__initCtx = c;
      const fs = mkScope(sc, c);
      inst.forEach((f) => f.value && rExpr(f.value, fs));
    }
    (s.fields || []).filter((f) => f.static).forEach((f) => f.value && rExpr(f.value, cs));
    for (const m of s.methods || []) if (!m.abstract) rFunc(m, cs, "method", m.name);
  }
  function rExpr(e, sc) {
    if (!e) return;
    switch (e.k) {
      case "num": case "str": case "bool": case "null": return;
      case "tmpl": e.parts.forEach((p) => typeof p !== "string" && rExpr(p, sc)); return;
      case "this": refThis(sc, e); return;
      case "super": refThis(sc, e); e.args.forEach((a) => rExpr(a, sc)); e.__cls = ref(sc, curClass(sc, e)); return;
      case "name":
        if (e.lazy) unsupported("ленивые переменные («лениво»)", e);
        if (e.ref === "builtin") { if (BUILTIN_NO[e.name]) fail("«" + e.name + "»: " + BUILTIN_NO[e.name], e); return; }
        e.__b = ref(sc, e.name);
        if (!e.__b && e.name === "Ошибка") { e.__b = "builtinErr"; return; }
        if (!e.__b) fail("неизвестное имя «" + e.name + "»", e);
        return;
      case "list": case "setlit": e.items.forEach((x) => rExpr(x, sc)); return;
      case "dict": e.entries.forEach((x) => { rExpr(x.key, sc); rExpr(x.value, sc); }); return;
      case "bin": rExpr(e.l, sc); rExpr(e.r, sc); return;
      case "un": rExpr(e.e, sc); return;
      case "cond": rExpr(e.cond, sc); rExpr(e.a, sc); rExpr(e.b, sc); return;
      case "index": rExpr(e.obj, sc); rExpr(e.index, sc); return;
      case "member": rExpr(e.obj, sc); return;
      case "mcall": rExpr(e.obj, sc); e.args.forEach((a) => rExpr(a, sc)); return;
      case "new": e.__b = ref(sc, e.name) || (e.name === "Ошибка" ? "builtinErr" : null); if (!e.__b) fail("неизвестный класс «" + e.name + "»", e); e.args.forEach((a) => rExpr(a, sc)); return;
      case "call":
        if (e.thisCtor || e.fn.k === "this") refThis(sc, e);
        else rExpr(e.fn, sc);
        e.args.forEach((a) => rExpr(a, sc));
        return;
      case "pipe":
        rExpr(e.left, sc);
        if (e.fn) rExpr(e.fn, sc);
        else if (e.mode === "class" || e.mode === "user") { e.__b = ref(sc, e.name) || (e.name === "Ошибка" ? "builtinErr" : null); if (!e.__b) fail("неизвестное имя «" + e.name + "»", e); }
        else if (e.mode === "builtin" && BUILTIN_NO[e.name]) fail("«" + e.name + "»: " + BUILTIN_NO[e.name], e);
        e.args.forEach((a) => rExpr(a, sc));
        return;
      case "lambda": e.__body = e.body || [{ k: "return", value: e.value, line: e.line }]; e.__ctx = rFunc({ params: e.params, body: e.__body, ret: null }, sc, "lambda", "безымянная"); return;
      case "walrus": rExpr(e.value, sc); e.__b = ref(sc, e.name); if (!e.__b) fail("неизвестное имя «" + e.name + "»", e); e.__b.assigned = true; return;
      case "methodref": rExpr(e.obj, sc); return;
      case "listcomp": case "setcomp": case "dictcomp": {
        rExpr(e.list, sc);
        const s2 = mkScope(sc, sc.ctx);
        e.__b = declare(s2, e.name); if (e.name2) e.__b2 = declare(s2, e.name2);
        if (e.cond) rExpr(e.cond, s2);
        if (e.key) rExpr(e.key, s2);
        rExpr(e.value, s2);
        return;
      }
      case "switchexpr": {
        rExpr(e.subject, sc);
        const c = newCtx("sx", sc.ctx, "выбор");
        e.__ctx = c;
        const fs = mkScope(sc, c);
        for (const cs of e.cases) {
          const s2 = mkScope(fs, c);
          if (cs.bind) cs.__b = declare(s2, cs.bind);
          (cs.values || []).forEach((v) => rExpr(v, s2));
          if (cs.guard) rExpr(cs.guard, s2);
          if (cs.value) rExpr(cs.value, s2); else rBlock(cs.body || [], s2);
        }
        if (e.def) { if (Array.isArray(e.def)) rBlock(e.def, fs); else rExpr(e.def, fs); }
        // значение выбора передаётся аргументом
        return;
      }
      case "refof": case "deref": unsupported("ссылки («ссылка на», «*»)", e); return;
      case "await": unsupported("«ждать»", e); return;
      case "thread": unsupported("потоки («поток»)", e); return;
      case "anonclass": unsupported("безымянные классы", e); return;
      case "raw": return;
    }
    fail("не умею переводить выражение «" + e.k + "» в машинный код", e);
  }
  const classStack = [];
  function curClass(sc, n) { if (!classStack.length) fail("«родитель» можно использовать только в методе класса", n); return classStack[classStack.length - 1]; }
  // rClass должен знать класс для «родитель»: оборачиваем
  const rClass0 = rClass;
  rClass = function (s, sc) { s.__b = s.__b || lookup(sc, s.name); classStack.push(s.name); try { rClass0(s, sc); } finally { classStack.pop(); } };

  rBody(program.body, root);

  // ---------------- генерация ----------------
  const K = new Map(); // строка → индекс
  const kOf = (s) => { if (!K.has(s)) K.set(s, K.size); return "K[" + K.get(s) + "]"; };
  const fnTexts = [];
  let out = null; // текущий список строк
  let ind = 1;
  let cur = null; // текущий ctx
  const emit = (s) => out.push("  ".repeat(ind) + s);
  const tmp = () => "t" + (++uid);
  let usedBuiltins = new Set();
  let needAbstract = false;

  const boxVar = (b) => {
    if (b.ctx === cur) return "v" + b.id;
    if (!cur.capIdx.has(b)) throw new Error("внутренняя ошибка: «" + b.name + "» не захвачена");
    return "c" + b.id;
  };
  const thisAtom = () => (ownsThis(cur) ? "self" : "cthis");
  function readB(b) {
    if (b === "builtinErr") return "rt_err_class()";
    if (b.global) return "G[" + b.gi + "]";
    if (b.boxed) return "(" + boxVar(b) + " & LOW48)->bv";
    return "v" + b.id;
  }
  function writeB(b, atom) {
    if (b.global) emit("G[" + b.gi + "] = " + atom + ";");
    else if (b.boxed) emit("(" + boxVar(b) + " & LOW48)->bv = " + atom + ";");
    else emit("v" + b.id + " = " + atom + ";");
  }
  function declB(b, atom) {
    if (b.pre) { writeB(b, atom); return; }
    if (b.global) emit("G[" + b.gi + "] = " + atom + ";");
    else if (b.boxed) emit("var v" + b.id + " = rt_box(" + atom + ");");
    else emit("var v" + b.id + " = " + atom + ";");
  }
  function snap(code) { const t = tmp(); emit("var " + t + " = " + code + ";"); return t; }
  const L = (n) => { if (n && n.line) emit("rt_L = " + n.line + ";"); };

  function args(list) {
    if (!list.length) return ["0", "0"];
    const atoms = list.map(E);
    const a = tmp();
    emit("var " + a + "[" + atoms.length + "];");
    atoms.forEach((x, i) => emit(a + "[" + i + "] = " + x + ";"));
    return [String(atoms.length), a];
  }
  function argsAtoms(atoms) {
    if (!atoms.length) return ["0", "0"];
    const a = tmp();
    emit("var " + a + "[" + atoms.length + "];");
    atoms.forEach((x, i) => emit(a + "[" + i + "] = " + x + ";"));
    return [String(atoms.length), a];
  }
  const typeCls = (tb) => (tb ? readB(tb) : "NUL");
  function typed(atom, t, name, tb) { return snap("rt_tp(" + atom + ", " + cStr(t) + ", " + cStr(name) + ", " + typeCls(tb) + ")"); }

  // создание замыкания для ctx c (в текущем ctx)
  function closure(c, fname, name, min, max) {
    const n = c.caps.length + (c.thisCap ? 1 : 0);
    const t = snap("rt_fn(" + fname + ", " + n + ", " + cStr(name || "безымянная") + ", " + min + ", " + max + ")");
    if (n) {
      const e = snap("ENV(" + t + ")");
      c.caps.forEach((b, i) => emit(e + "[" + i + "] = " + boxVar(b) + ";"));
      if (c.thisCap) emit(e + "[" + c.caps.length + "] = " + thisAtom() + ";");
    }
    return t;
  }
  // текст функции для ctx c; body — функция, печатающая тело
  function emitFn(c, fname, bodyFn) {
    const savedOut = out, savedInd = ind, savedCur = cur;
    out = []; ind = 1; cur = c;
    try {
      emit("rt_enter();");
      if (c.caps.length || c.thisCap) {
        emit("var envp = ENV(F);");
        c.caps.forEach((b, i) => emit("var c" + b.id + " = envp[" + i + "];"));
        if (c.thisCap) emit("var cthis = envp[" + c.caps.length + "];");
      }
      bodyFn();
      emit("rt_depth -= 1;");
      emit("return NUL;");
      fnTexts.push("fn " + fname + "(F, self, argc, argv) {\n" + out.join("\n") + "\n}\n");
    } finally { out = savedOut; ind = savedInd; cur = savedCur; }
  }
  function params(ps) {
    ps.forEach((q, i) => {
      const v = "v" + q.__b.id;
      emit("var " + v + " = UNDEF; if (argc > " + i + ") { " + v + " = argv[" + i + "]; }");
      emit("if (" + v + " == UNDEF) {");
      ind++;
      if (q.def) { const a = E(q.def); emit(v + " = " + a + ";"); } else emit("rt_missing(" + cStr(q.name) + ");");
      ind--;
      emit("}");
      if (q.type) emit(v + " = rt_tp(" + v + ", " + cStr(q.type) + ", " + cStr(q.name) + ", " + typeCls(q.__tb) + ");");
      if (q.__b.boxed) emit(v + " = rt_box(" + v + ");");
    });
  }
  const fnNames = new Map();
  function fnName(c) { if (!fnNames.has(c)) fnNames.set(c, "f" + c.id); return fnNames.get(c); }
  function arity(ps) { return [ps.filter((q) => !q.def).length, ps.length]; }
  function funcCtx(f, name) {
    const c = f.__ctx, fname = fnName(c);
    emitFn(c, fname, () => {
      params(f.params || []);
      c.ret = f.ret ? { t: f.ret, tb: f.__rb, name: "результат функции «" + (f.name || "") + "»" } : null;
      block(f.body || [], false);
    });
    const [mn, mx] = arity(f.params || []);
    return closure(c, fname, name, mn, mx);
  }

  // ---- блоки и операторы ----
  function block(list, scoped) {
    // поднятые функции: сначала ячейки, потом замыкания
    const funcs = list.filter((s) => s.k === "func");
    for (const s of list) {
      const bs = [];
      if (["func", "class", "struct", "iface", "enum"].includes(s.k) || (s.k === "let" && s.kind !== "global") || (s.k === "integral" && s.declare) || (s.k === "module" && s.alias)) bs.push(s.__b);
      if (s.k === "multilet" || (s.k === "module" && s.names)) bs.push(...s.__bs);
      for (const b of bs) {
        if (b.global) continue;
        if (b.boxed || s.k === "func" || s.k === "class" || s.k === "struct" || s.k === "iface") { b.pre = false; declB(b, "NUL"); b.pre = true; }
      }
    }
    for (const s of funcs) { const t = funcCtx(s, s.name); writeB(s.__b, t); }
    for (const s of list) S(s);
  }
  function sub(list) { emit("{"); ind++; block(list || []); ind--; emit("}"); }

  function runFins(downTo) {
    for (let i = cur.fins.length - 1; i >= downTo; i--) {
      const f = cur.fins[i];
      const saved = cur.fins; cur.fins = cur.fins.slice(0, i);
      try { f(); } finally { cur.fins = saved; }
    }
  }
  function emitReturn(atom) {
    if (cur.kind === "main" || cur.kind === "module" && false) { /* верни в главной программе */ }
    let v = atom;
    if (cur.ret) v = typed(v, cur.ret.t, cur.ret.name, cur.ret.tb);
    else if (cur.fins.length) v = snap(v);
    runFins(0);
    if (cur.kind === "main") { emit("rt_exit(0);"); return; }
    emit("rt_depth -= 1;");
    emit("return " + v + ";");
  }
  function withFinally(bodyFn, finFn) {
    const p = tmp(), h = tmp(), d = tmp();
    emit("var " + p + " = UNDEF; var " + h + " = 0; var " + d + " = rt_depth;");
    cur.fins.push(finFn);
    emit("try {"); ind++;
    try { bodyFn(); } finally { cur.fins.pop(); }
    ind--;
    emit("} catch { rt_depth = " + d + "; " + p + " = rt_exc; " + h + " = 1; }");
    finFn();
    emit("if (" + h + ") { rt_throw(" + p + "); }");
  }
  function loop(kind, bodyFn) {
    const rec = { fins: cur.fins.length, kind };
    cur.loops.push(rec);
    try { bodyFn(rec); } finally { cur.loops.pop(); }
  }

  function assignTo(s, valueAtomFn) {
    const t = s.target;
    if (t.k === "name") {
      const b = t.__b;
      let v;
      if (s.op === "=") v = valueAtomFn();
      else { const old = snap(readB(b)); const r = valueAtomFn(); v = arith(s.op[0], old, r); }
      if (s.checkType) v = typed(v, s.checkType, t.name, s.__tb);
      writeB(b, v);
      return;
    }
    const o = E(t.obj);
    const k = t.k === "index" ? E(t.index) : kOf(t.name);
    const doSet = () => {
      let v;
      if (s.op === "=") v = valueAtomFn();
      else {
        const old = snap((t.k === "index" ? "rt_idx(" : "rt_get(") + o + ", " + k + ")");
        const r = valueAtomFn();
        v = arith(s.op[0], old, r);
      }
      emit((t.k === "index" ? "rt_setidx(" : "rt_set(") + o + ", " + k + ", " + v + ");");
    };
    if (t.safe) { emit("if (!ISNIL(" + o + ")) {"); ind++; doSet(); ind--; emit("}"); } else doSet();
  }

  function S(s) {
    switch (s.k) {
      case "let": {
        L(s);
        let v = E(s.value);
        if (s.type) v = typed(v, s.type, s.name, s.__tb);
        if (s.kind === "forever") v = snap("rt_forever(" + v + ")");
        if (s.kind === "global") { writeB(s.__b, v); return; }
        declB(s.__b, v);
        return;
      }
      case "multilet": {
        L(s);
        const t = snap("rt_unpack(" + E(s.value) + ", " + s.names.length + ")");
        s.__bs.forEach((b, i) => { let v = snap("ITEMS(" + t + ")[" + i + "]"); if (s.kind === "forever") v = snap("rt_forever(" + v + ")"); declB(b, v); });
        return;
      }
      case "multiassign": {
        L(s);
        const t = snap("rt_unpack(" + E(s.value) + ", " + s.parts.length + ")");
        s.parts.forEach((pt, i) => assignTo(pt, () => snap("ITEMS(" + t + ")[" + i + "]")));
        return;
      }
      case "dowhile": {
        L(s);
        const brk = tmp();
        emit("var " + brk + " = 0;");
        emit("while (1) {"); ind++;
        loop("dowhile", (rec) => {
          rec.brk = brk;
          emit("while (1) {"); ind++;
          block(s.body);
          emit("break;");
          ind--; emit("}");
        });
        emit("if (" + brk + ") { break; }");
        const c = condOf(s.cond);
        emit("if (!(" + c + ")) { break; }");
        ind--; emit("}");
        return;
      }
      case "assert": {
        L(s);
        const c = E(s.cond);
        emit("if (!rt_truth(" + c + ")) {"); ind++;
        const m = s.msg ? E(s.msg) : kOf("проверка не прошла" + (s.line ? " (строка " + s.line + ")" : ""));
        emit("rt_throw(" + m + ");");
        ind--; emit("}");
        return;
      }
      case "enum": {
        L(s);
        const names = argsAtoms(s.items.map((it) => kOf(it.name)));
        const vals = argsAtoms(s.items.map((it) => (it.value ? E(it.value) : "UNDEF")));
        declB(s.__b, snap("rt_enum(" + names[0] + ", " + names[1] + ", " + vals[1] + ")"));
        return;
      }
      case "iface": {
        L(s);
        const ms = argsAtoms(s.methods.map((m) => kOf(m.name)));
        writeB(s.__b, snap("rt_iface(" + kOf(s.name) + ", " + ms[0] + ", " + ms[1] + ")"));
        return;
      }
      case "assign": L(s); assignTo(s, () => E(s.value)); return;
      case "print": {
        L(s);
        const [n, a] = args(s.items);
        if (s.err) emit("rt_eprint(" + n + ", " + a + ", " + (s.err === "debug" || s.err === "отладка" ? 1 : 0) + ");");
        else emit("rt_print(" + n + ", " + a + ");");
        return;
      }
      case "expr": L(s); E(s.expr, true); return;
      case "pass": return;
      case "avos": {
        L(s);
        const d = tmp(); emit("var " + d + " = rt_depth;");
        emit("try {"); ind++; block(s.body); ind--;
        emit("} catch {"); ind++;
        emit("rt_depth = " + d + "; rt_avos_msg();");
        if (s.inFn && cur.kind !== "main") emitReturn(numLit(42));
        ind--; emit("}");
        return;
      }
      case "feature": {
        L(s);
        const d = tmp(); emit("var " + d + " = rt_depth;");
        emit("try {"); ind++; block(s.body); ind--;
        emit("} catch { rt_depth = " + d + "; rt_feature_show(rt_exc); }");
        return;
      }
      case "quiet": {
        L(s);
        emit("rt_mute += 1;");
        withFinally(() => block(s.body), () => emit("rt_mute -= 1;"));
        return;
      }
      case "integral": {
        L(s);
        const f = E(s.fn), a = E(s.from), b = E(s.to);
        const n = s.steps ? E(s.steps) : "NUL", h = s.step ? E(s.step) : "NUL";
        const r = snap("rt_integral(" + f + ", " + a + ", " + b + ", " + n + ", " + h + ")");
        if (s.declare) declB(s.__b, r); else writeB(s.__b, r);
        return;
      }
      case "if": {
        L(s);
        const c = condOf(s.cond);
        emit("if (" + c + ") {"); ind++; block(s.then); ind--;
        if (s.otherwise) { emit("} else {"); ind++; block(s.otherwise); ind--; }
        emit("}");
        return;
      }
      case "while": {
        L(s);
        emit("while (1) {"); ind++;
        const c = condOf(s.cond);
        emit("if (!(" + c + ")) { break; }");
        loop("while", () => block(s.body));
        ind--; emit("}");
        return;
      }
      case "repeat": {
        L(s);
        const n = snap("rt_count(" + E(s.count) + ")");
        const i = tmp(), m = tmp();
        emit("var " + m + " = 0; if (flt(" + n + ", 9.0e18)) { " + m + " = f2i(" + n + "); } else { " + m + " = 0x7FFFFFFFFFFFFFFF; }");
        emit("if (!fge(" + n + ", 0.0)) { " + m + " = 0; }");
        emit("var " + i + " = 0;");
        emit("for (; " + i + " < " + m + "; " + i + " += 1) {"); ind++;
        loop("repeat", () => block(s.body));
        ind--; emit("}");
        return;
      }
      case "foreach": {
        L(s);
        const it = snap((s.name2 ? "rt_pairs(" : "rt_iter(") + E(s.list) + ")");
        const i = tmp();
        emit("var " + i + " = 0;");
        emit("while (" + i + " < LEN(" + it + ")) {"); ind++;
        const x = snap("ITEMS(" + it + ")[" + i + "]");
        emit(i + " += 1;");
        if (s.name2) { declB(s.__b, snap("ITEMS(" + x + ")[0]")); declB(s.__b2, snap("ITEMS(" + x + ")[1]")); }
        else declB(s.__b, x);
        loop("foreach", () => block(s.body));
        ind--; emit("}");
        return;
      }
      case "forrange": {
        L(s);
        const a = snap("rt_num(" + E(s.from) + ", \"начало цикла\")");
        const b = snap("rt_num(" + E(s.to) + ", \"конец цикла\")");
        const st = tmp();
        if (s.step) emit("var " + st + " = rt_step(" + E(s.step) + ");");
        else emit("var " + st + " = 1.0; if (!fle(" + a + ", " + b + ")) { " + st + " = -1.0; }");
        const i = tmp();
        emit("var " + i + " = " + a + ";");
        emit("for (; (fgt(" + st + ", 0.0) && fle(" + i + ", " + b + ")) || (!fgt(" + st + ", 0.0) && fge(" + i + ", " + b + ")); " + i + " = fadd(" + i + ", " + st + ")) {"); ind++;
        declB(s.__b, i);
        loop("forrange", () => block(s.body));
        ind--; emit("}");
        return;
      }
      case "func": return; // создана в начале блока
      case "return": { L(s); const v = s.value ? E(s.value) : "NUL"; emitReturn(v); return; }
      case "break": case "continue": {
        L(s);
        const rec = cur.loops[cur.loops.length - 1];
        if (!rec) fail("«" + (s.k === "break" ? "стоп" : "дальше") + "» вне цикла", s);
        runFins(rec.fins);
        if (rec.kind === "dowhile") { if (s.k === "break") emit(rec.brk + " = 1;"); emit("break;"); }
        else emit(s.k + ";");
        return;
      }
      case "throw": { L(s); const v = E(s.value); emit("rt_throw(" + v + ");"); return; }
      case "try": { L(s); emitTry(s); return; }
      case "switch": {
        L(s);
        const sv = snap(E(s.subject));
        const done = tmp();
        emit("var " + done + " = 0;");
        for (const c of s.cases) {
          emit("if (!" + done + ") {"); ind++;
          if (c.bind) declB(c.__b, sv);
          const ok = tmp();
          emit("var " + ok + " = 0;");
          if (c.bind) emit(ok + " = 1;");
          else for (const v of c.values) { emit("if (!" + ok + ") {"); ind++; const a = E(v); emit(ok + " = rt_eqb(" + sv + ", " + a + ");"); ind--; emit("}"); }
          if (c.guard) { emit("if (" + ok + ") {"); ind++; const g = E(c.guard); emit(ok + " = rt_truth(" + g + ");"); ind--; emit("}"); }
          emit("if (" + ok + ") {"); ind++;
          emit(done + " = 1;");
          block(c.body);
          ind--; emit("}");
          ind--; emit("}");
        }
        if (s.def) { emit("if (!" + done + ") {"); ind++; block(s.def); ind--; emit("}"); }
        return;
      }
      case "class": L(s); emitClass(s); return;
      case "struct": {
        L(s);
        const cls = snap("rt_class_new(" + kOf(s.name) + ", NUL)");
        writeB(s.__b, cls);
        const c = s.__ctx, fname = fnName(c);
        emitFn(c, fname, () => {
          params(s.params);
          for (const q of s.params) emit("rt_set(self, " + kOf(q.name) + ", " + readB(q.__b) + ");");
        });
        const [mn, mx] = arity(s.params);
        const f = closure(c, fname, s.name, mn, mx);
        emit("rt_class_struct(" + cls + ", " + f + ");");
        return;
      }
      case "with": {
        L(s);
        const m = snap(E(s.value));
        withFinally(() => {
          declB(s.__b, snap("rt_with_enter(" + m + ")"));
          block(s.body);
        }, () => emit("rt_with_exit(" + m + ");"));
        return;
      }
      case "module": { L(s); emitModule(s); return; }
    }
    fail("не умею переводить конструкцию «" + s.k + "» в машинный код", s);
  }

  function emitTry(s) {
    const hs = s.__hs;
    const inner = () => {
      if (!hs.length) { block(s.body); return; }
      const d = tmp();
      emit("var " + d + " = rt_depth;");
      emit("try {"); ind++; block(s.body); ind--;
      emit("} catch {"); ind++;
      emit("rt_depth = " + d + ";");
      const ev = snap("rt_exc");
      hs.forEach((h, i) => {
        const cond = h.type ? "rt_isa(" + ev + ", " + cStr(h.type) + ", " + typeCls(h.__tb) + ")" : "1";
        emit((i ? "} else " : "") + "if (" + cond + ") {"); ind++;
        if (h.errName) declB(h.__b, ev);
        block(h.body);
        ind--;
      });
      emit("} else { rt_throw(" + ev + "); }");
      ind--; emit("}");
    };
    if (s.fin) withFinally(inner, () => { emit("{"); ind++; block(s.fin); ind--; emit("}"); });
    else inner();
  }

  function emitClass(s) {
    const parent = s.parent && s.parentKind !== "iface" ? readB(s.__pb) : "NUL";
    const pa = parent === "NUL" ? "NUL" : snap(parent);
    const cls = snap("rt_class_new(" + kOf(s.name || "безымянный") + ", " + pa + ")");
    writeB(s.__b, cls);
    if (s.__initCtx) {
      const c = s.__initCtx, fname = fnName(c);
      emitFn(c, fname, () => {
        for (const f of s.fields.filter((f) => !f.static)) { const v = f.value ? E(f.value) : "NUL"; emit("rt_set(self, " + kOf(f.name) + ", " + v + ");"); }
      });
      emit("rt_class_init(" + cls + ", " + closure(c, fname, "__init", 0, 0) + ");");
    }
    for (const f of (s.fields || []).filter((f) => f.static)) { const v = f.value ? E(f.value) : "NUL"; emit("rt_class_add(" + cls + ", 3, " + kOf(f.name) + ", " + v + ");"); }
    const ctors = (s.methods || []).filter((m) => m.name === "создать" && !m.static && !m.getter && !m.setter && !m.abstract);
    for (const m of s.methods || []) {
      let f;
      if (m.abstract) {
        needAbstract = true;
        f = snap("rt_fn(f_abstract, 1, " + cStr(m.name) + ", 0, 99)");
        emit("ENV(" + f + ")[0] = " + kOf("функция «" + m.name + "» класса «" + (s.name || "безымянный") + "» абстрактная: её нужно написать в классе-наследнике") + ";");
      } else f = funcCtx(m, m.name);
      const kind = m.static ? 3 : m.getter ? 1 : m.setter ? 2 : 0;
      if (ctors.length > 1 && ctors.includes(m)) emit("rt_class_ctor(" + cls + ", " + f + ");");
      else emit("rt_class_add(" + cls + ", " + kind + ", " + kOf(m.name) + ", " + f + ");");
    }
    const ifs = (s.__ifb || []).slice();
    if (s.parent && s.parentKind === "iface") ifs.push(s.__pb);
    if (ifs.length) {
      const a = argsAtoms(ifs.map((b) => snap(readB(b))));
      emit("rt_implements(" + cls + ", " + a[0] + ", " + a[1] + ");");
    }
  }

  const moduleShares = new Map();
  function emitModule(s) {
    let modAtom;
    if (s.__dup && !moduleShares.has(s.share)) fail("внутренняя ошибка: повторный модуль раньше первого", s);
    if (s.__dup) modAtom = snap("G[" + moduleShares.get(s.share) + "]");
    else {
      const c = s.__ctx, fname = fnName(c);
      emitFn(c, fname, () => {
        block(s.body);
        const kv = [];
        for (const [n, b] of s.__exp) { kv.push(kOf(n)); kv.push(snap(readB(b))); }
        const a = argsAtoms(kv);
        emit("rt_depth -= 1;");
        emit("return rt_dict(" + (kv.length / 2) + ", " + a[1] + ");");
      });
      const f = closure(c, fname, "модуль", 0, 0);
      modAtom = snap(fname + "(" + f + ", UNDEF, 0, 0)");
      if (s.share) {
        const hb = { id: ++uid, name: "#mod", global: true };
        hb.gi = globals.push(hb) - 1;
        moduleShares.set(s.share, hb.gi);
        emit("G[" + hb.gi + "] = " + modAtom + ";");
      }
    }
    if (s.alias) declB(s.__b, modAtom);
    if (s.names) s.names.forEach((n, i) => declB(s.__bs[i], snap("rt_get(" + modAtom + ", " + kOf(n.name) + ")")));
  }

  // ---- выражения: возвращают «атом» (временную, константу) ----
  function builtinCall(name, atoms, n) {
    if (BUILTIN_NO[name]) fail("«" + name + "»: " + BUILTIN_NO[name], n);
    const fn = BUILTIN_FN[name];
    if (!fn) fail("встроенная функция «" + name + "» недоступна в нативной сборке", n);
    usedBuiltins.add(name);
    const [c, a] = argsAtoms(atoms);
    return snap(fn + "(0, UNDEF, " + c + ", " + a + ")");
  }
  function directFn(b) {
    return b && b !== "builtinErr" && b.isFunc && !b.assigned && b.node && b.node.__ctx ? b.node.__ctx : null;
  }
  const CMP = { "<": "flt", ">": "fgt", "<=": "fle", ">=": "fge", "==": "feq", "!=": "fne" };
  const FAST = { "+": "fadd", "-": "fsub", "*": "fmul", "/": "fdiv" };
  // условие как целое 0/1 (для if/while), с быстрым путём для чисел
  function arith(op, l, r) {
    if (FAST[op]) {
      const t = tmp();
      const guard = "isnum(" + l + ") && isnum(" + r + ")" + (op === "/" ? " && " + r + " != 0 && " + r + " != 0x8000000000000000" : "");
      emit("var " + t + " = 0; if (" + guard + ") { " + t + " = " + FAST[op] + "(" + l + ", " + r + "); } else { " + t + " = " + OPS[op] + "(" + l + ", " + r + "); }");
      return t;
    }
    return snap(OPS[op] + "(" + l + ", " + r + ")");
  }
  function condOf(e) {
    if (e.k === "bin" && CMP[e.op]) {
      const l = E(e.l), r = E(e.r);
      const t = tmp();
      const slow = e.op === "==" ? "rt_eqb(" + l + ", " + r + ")" : e.op === "!=" ? "!rt_eqb(" + l + ", " + r + ")" : "rt_truth(" + OPS[e.op] + "(" + l + ", " + r + "))";
      emit("var " + t + " = 0; if (isnum(" + l + ") && isnum(" + r + ")) { " + t + " = " + CMP[e.op] + "(" + l + ", " + r + "); } else { " + t + " = " + slow + "; }");
      return t;
    }
    if (e.k === "un" && e.op === "не") return "!" + condOf(e.e);
    if (e.k === "bool") return e.v ? "1" : "0";
    const v = E(e);
    return "rt_truth(" + v + ")";
  }
  function E(e, discard) {
    switch (e.k) {
      case "num": return numLit(e.v);
      case "str": return kOf(e.v);
      case "bool": return e.v ? "TRUEV" : "FALSEV";
      case "null": return "NUL";
      case "this": return thisAtom();
      case "tmpl": {
        const atoms = e.parts.map((p) => (typeof p === "string" ? kOf(p) : E(p)));
        const [n, a] = argsAtoms(atoms);
        return snap("rt_tmpl(" + n + ", " + a + ")");
      }
      case "super": {
        const [n, a] = args(e.args);
        return snap("rt_super_call(" + snap(readB(e.__cls)) + ", " + thisAtom() + ", " + kOf(e.name) + ", " + n + ", " + a + ")");
      }
      case "name":
        if (e.ref === "builtin") {
          if (e.name === "ПИ") return numLit(Math.PI);
          if (e.name === "бесконечность") return numLit(Infinity);
          if (e.name === "аргументы" || e.name === "argv") return snap("rt_args_list()");
          if (!BUILTIN_FN[e.name]) fail("встроенная функция «" + e.name + "» недоступна в нативной сборке", e);
          usedBuiltins.add(e.name);
          return snap("dict_get(rt_B, " + kOf(e.name) + ")");
        }
        return snap(readB(e.__b));
      case "raw": fail("внутренняя ошибка: raw", e); break;
      case "list": { const [n, a] = args(e.items); return snap("rt_list(" + n + ", " + a + ")"); }
      case "setlit": { const [n, a] = args(e.items); return snap("rt_setlit(" + n + ", " + a + ")"); }
      case "dict": {
        const atoms = [];
        for (const x of e.entries) { atoms.push(E(x.key)); atoms.push(E(x.value)); }
        const [, a] = argsAtoms(atoms);
        return snap("rt_dict(" + e.entries.length + ", " + a + ")");
      }
      case "bin": {
        if (e.op === "и" || e.op === "или") {
          const l = E(e.l);
          const r = tmp();
          if (e.op === "и") {
            emit("var " + r + " = FALSEV;");
            emit("if (rt_truth(" + l + ")) {"); ind++; const b = E(e.r); emit(r + " = BOOLV(rt_truth(" + b + "));"); ind--; emit("}");
          } else {
            emit("var " + r + " = " + l + ";");
            emit("if (!rt_truth(" + l + ")) {"); ind++; const b = E(e.r); emit(r + " = " + b + ";"); ind--; emit("}");
          }
          return r;
        }
        if (CMP[e.op]) return snap("BOOLV(" + condOf(e) + ")");
        const l = E(e.l), r = E(e.r);
        return arith(e.op, l, r);
      }
      case "un": {
        const v = E(e.e);
        if (e.op === "не") return snap("BOOLV(!rt_truth(" + v + "))");
        return snap("rt_neg(" + v + ")");
      }
      case "cond": {
        const c = condOf(e.cond);
        const r = tmp();
        emit("var " + r + " = NUL;");
        emit("if (" + c + ") {"); ind++; emit(r + " = " + E(e.a) + ";"); ind--;
        emit("} else {"); ind++; emit(r + " = " + E(e.b) + ";"); ind--; emit("}");
        return r;
      }
      case "index": { const o = E(e.obj), i = E(e.index); return snap((e.safe ? "rt_sidx(" : "rt_idx(") + o + ", " + i + ")"); }
      case "member": { const o = E(e.obj); return snap((e.safe ? "rt_sget(" : "rt_get(") + o + ", " + kOf(e.name) + ")"); }
      case "mcall": {
        const o = E(e.obj);
        const [n, a] = args(e.args);
        return snap((e.safe ? "rt_scall(" : "rt_call(") + o + ", " + kOf(e.name) + ", " + n + ", " + a + ")");
      }
      case "new": { const c = snap(readB(e.__b)); const [n, a] = args(e.args); return snap("rt_new(" + c + ", " + n + ", " + a + ")"); }
      case "call": return emitCall(e);
      case "pipe": {
        const left = E(e.left);
        const atoms = [left].concat(e.args.map(E));
        if (e.fn) { const f = E(e.fn); const [n, a] = argsAtoms(atoms); return snap("rt_apply(" + f + ", \"значение\", " + n + ", " + a + ")"); }
        if (e.mode === "builtin") return builtinCall(e.name, atoms, e);
        if (e.mode === "class") { const c = snap(readB(e.__b)); const [n, a] = argsAtoms(atoms); return snap("rt_new(" + c + ", " + n + ", " + a + ")"); }
        if (e.mode === "user") { const f = snap(readB(e.__b)); const [n, a] = argsAtoms(atoms); return snap("rt_apply(" + f + ", " + cStr(e.name) + ", " + n + ", " + a + ")"); }
        const [n, a] = argsAtoms(atoms.slice(1));
        return snap("rt_call(" + left + ", " + kOf(e.name) + ", " + n + ", " + a + ")");
      }
      case "lambda": {
        const c = e.__ctx, fname = fnName(c);
        emitFn(c, fname, () => {
          params(e.params);
          c.ret = null;
          block(e.__body);
        });
        const [mn, mx] = arity(e.params);
        return closure(c, fname, "безымянная", mn, mx);
      }
      case "walrus": { const v = E(e.value); writeB(e.__b, v); return v; }
      case "methodref": { const o = E(e.obj); return snap("rt_methodref(" + o + ", " + kOf(e.name) + ")"); }
      case "listcomp": case "setcomp": case "dictcomp": {
        const res = snap(e.k === "listcomp" ? "list_new(4)" : e.k === "setcomp" ? "dict_new(1)" : "dict_new(0)");
        const it = snap((e.name2 ? "rt_pairs(" : "rt_iter(") + E(e.list) + ")");
        const i = tmp();
        emit("var " + i + " = 0;");
        emit("while (" + i + " < LEN(" + it + ")) {"); ind++;
        const x = snap("ITEMS(" + it + ")[" + i + "]");
        emit(i + " += 1;");
        if (e.name2) { declB(e.__b, snap("ITEMS(" + x + ")[0]")); declB(e.__b2, snap("ITEMS(" + x + ")[1]")); }
        else declB(e.__b, x);
        const body = () => {
          if (e.k === "dictcomp") { const k = E(e.key); const v = E(e.value); emit("dict_set(" + res + ", check_key(" + k + "), " + v + ");"); }
          else if (e.k === "setcomp") { const v = E(e.value); emit("dict_set(" + res + ", " + v + ", TRUEV);"); }
          else { const v = E(e.value); emit("list_push(" + res + ", " + v + ");"); }
        };
        if (e.cond) { const c = E(e.cond); emit("if (rt_truth(" + c + ")) {"); ind++; body(); ind--; emit("}"); }
        else body();
        ind--; emit("}");
        return res;
      }
      case "switchexpr": {
        const subj = E(e.subject);
        const c = e.__ctx, fname = fnName(c);
        emitFn(c, fname, () => {
          c.ret = null;
          const sv = "argv[0]";
          const svv = snap(sv);
          for (const cs of e.cases) {
            emit("{"); ind++;
            if (cs.bind) declB(cs.__b, svv);
            const ok = tmp();
            emit("var " + ok + " = 0;");
            if (cs.bind) emit(ok + " = 1;");
            else for (const v of cs.values || []) { emit("if (!" + ok + ") {"); ind++; const a = E(v); emit(ok + " = rt_eqb(" + svv + ", " + a + ");"); ind--; emit("}"); }
            if (cs.guard) { emit("if (" + ok + ") {"); ind++; const g = E(cs.guard); emit(ok + " = rt_truth(" + g + ");"); ind--; emit("}"); }
            emit("if (" + ok + ") {"); ind++;
            if (cs.value) emitReturn(E(cs.value)); else { block(cs.body || []); emitReturn("NUL"); }
            ind--; emit("}");
            ind--; emit("}");
          }
          if (e.def) { if (Array.isArray(e.def)) { block(e.def); emitReturn("NUL"); } else emitReturn(E(e.def)); }
        });
        const f = closure(c, fname, "выбор", 1, 1);
        const [, a] = argsAtoms([subj]);
        return snap(fname + "(" + f + ", UNDEF, 1, " + a + ")");
      }
    }
    fail("не умею переводить выражение «" + e.k + "» в машинный код", e);
  }
  function emitCall(e) {
    if (e.thisCtor || e.fn.k === "this") { const [n, a] = args(e.args); return snap("rt_this_ctor(" + thisAtom() + ", " + n + ", " + a + ")"); }
    if (e.fn.k === "name" && e.fn.ref === "class") { const c = snap(readB(e.fn.__b)); const [n, a] = args(e.args); return snap("rt_new(" + c + ", " + n + ", " + a + ")"); }
    if (e.fn.k === "name" && e.fn.ref === "builtin") {
      if (e.fn.name === "приложить_подорожник" && e.args.length === 1) {
        const r = tmp(), d = tmp();
        emit("var " + r + " = UNDEF; var " + d + " = rt_depth;");
        emit("try {"); ind++; const v = E(e.args[0]); emit(r + " = " + v + ";"); ind--;
        emit("} catch { rt_depth = " + d + "; " + r + " = UNDEF; }");
        usedBuiltins.add("приложить_подорожник");
        emit("if (" + r + " == UNDEF || plantain_ok(" + r + ")) { " + r + " = " + kOf("Да вроде работает") + "; }");
        return r;
      }
      const atoms = e.args.map(E);
      return builtinCall(e.fn.name, atoms, e);
    }
    if (e.fn.k === "name") {
      const b = e.fn.__b;
      const dc = directFn(b);
      if (dc) {
        const f = snap(readB(b));
        const [n, a] = args(e.args);
        return snap(fnName(dc) + "(" + f + ", UNDEF, " + n + ", " + a + ")");
      }
      const f = snap(readB(b));
      const [n, a] = args(e.args);
      return snap("rt_apply(" + f + ", " + cStr(e.fn.name) + ", " + n + ", " + a + ")");
    }
    const f = E(e.fn);
    const [n, a] = args(e.args);
    if (e.safe) return snap("rt_sapply(" + f + ", " + n + ", " + a + ")");
    return snap("rt_apply(" + f + ", \"значение\", " + n + ", " + a + ")");
  }

  // ---- главная программа ----
  const mainCtx = root.ctx;
  out = []; ind = 1; cur = mainCtx;
  block(program.body);
  const mainBody = out;

  const kInit = [];
  for (const [s, i] of K) kInit.push("  K[" + i + "] = strn(" + cStr(s) + ", " + Buffer.byteLength(s, "utf8") + ");");
  const ng = Math.max(globals.length, 1), nk = Math.max(K.size, 1);
  let text = "global G[" + ng + "];\nglobal K[" + nk + "];\n";
  if (needAbstract) text += "fn f_abstract(F, self, argc, argv) { rt_throw(ENV(F)[0]); return 0; }\n";
  text += "fn prog_main() {\n  var i = 0; while (i < " + ng + ") { G[i] = NUL; i += 1; }\n  i = 0; while (i < " + nk + ") { K[i] = NUL; i += 1; }\n  gc_root(G, " + ng + "); gc_root(K, " + nk + ");\n" + kInit.join("\n") + "\n" + mainBody.join("\n") + "\n  return 0;\n}\n";
  text += fnTexts.join("\n");
  // регистрация встроенных функций, которые используются как значения
  const regs = [...usedBuiltins].filter((n) => BUILTIN_FN[n]).map((n) => "  regb(" + cStr(n) + ", " + BUILTIN_FN[n] + ");");
  text += "fn rt_init_builtins() {\n" + regs.join("\n") + "\n  return 0;\n}\n";
  return text;
}

module.exports = { translate, NativeError };

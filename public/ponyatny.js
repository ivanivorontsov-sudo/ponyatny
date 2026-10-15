(function (root) {
  const KEYWORDS = new Set(["пусть", "напиши", "если", "то", "иначе", "пока", "повторить", "раз", "функция", "верни", "конец", "и", "или", "не", "истина", "ложь", "ничего", "для", "каждого", "из", "стоп"]);

  class LangError extends Error {
    constructor(message, line) {
      super(line ? "Строка " + line + ": " + message : message);
      this.line = line;
    }
  }

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    const isLetter = (c) => /[A-Za-zА-Яа-яЁё_]/.test(c);
    const isDigit = (c) => /[0-9]/.test(c);
    while (i < src.length) {
      const c = src[i];
      if (c === "\n") { tokens.push({ t: "nl", line }); line++; i++; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "#" || (c === "/" && src[i + 1] === "/")) {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === '"' || c === "«") {
        const close = c === '"' ? '"' : "»";
        let s = "";
        i++;
        while (i < src.length && src[i] !== close) {
          if (src[i] === "\n") throw new LangError("строка не закрыта кавычкой", line);
          if (src[i] === "\\" && src[i + 1] === "n") { s += "\n"; i += 2; continue; }
          s += src[i++];
        }
        if (i >= src.length) throw new LangError("строка не закрыта кавычкой", line);
        i++;
        tokens.push({ t: "str", v: s, line });
        continue;
      }
      if (isDigit(c)) {
        let s = "";
        while (i < src.length && (isDigit(src[i]) || (src[i] === "." && isDigit(src[i + 1] || "")))) s += src[i++];
        tokens.push({ t: "num", v: parseFloat(s), line });
        continue;
      }
      if (isLetter(c)) {
        let s = "";
        while (i < src.length && (isLetter(src[i]) || isDigit(src[i]))) s += src[i++];
        const low = s.toLowerCase();
        if (KEYWORDS.has(low)) tokens.push({ t: "kw", v: low, line });
        else tokens.push({ t: "id", v: s, line });
        continue;
      }
      const two = src.substr(i, 2);
      if (["==", "!=", "<=", ">="].includes(two)) { tokens.push({ t: "op", v: two, line }); i += 2; continue; }
      if ("+-*/%()<>=,[]".includes(c)) { tokens.push({ t: "op", v: c, line }); i++; continue; }
      throw new LangError("непонятный символ «" + c + "»", line);
    }
    tokens.push({ t: "nl", line });
    tokens.push({ t: "eof", line });
    return tokens;
  }

  function parse(src) {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    const is = (t, v) => peek().t === t && (v === undefined || peek().v === v);
    const accept = (t, v) => (is(t, v) ? next() : null);
    const expect = (t, v, what) => {
      if (is(t, v)) return next();
      const tok = peek();
      throw new LangError("ожидалось " + (what || "«" + v + "»") + ", а встретилось " + describe(tok), tok.line);
    };
    const describe = (tok) => tok.t === "nl" ? "конец строки" : tok.t === "eof" ? "конец программы" : "«" + tok.v + "»";
    const skipNl = () => { while (is("nl")) next(); };
    const endLine = () => { if (!is("eof")) expect("nl", undefined, "конец строки"); };

    function block(enders) {
      const body = [];
      skipNl();
      while (!enders.some((e) => is("kw", e))) {
        if (is("eof")) throw new LangError("не хватает слова «конец»", peek().line);
        body.push(statement());
        skipNl();
      }
      return body;
    }

    function statement() {
      const tok = peek();
      const line = tok.line;
      if (accept("kw", "пусть")) {
        const name = expect("id", undefined, "имя переменной").v;
        expect("op", "=");
        const value = expr();
        endLine();
        return { k: "let", name, value, line };
      }
      if (accept("kw", "напиши")) {
        const items = [];
        if (!is("nl")) {
          items.push(expr());
          while (accept("op", ",")) items.push(expr());
        }
        endLine();
        return { k: "print", items, line };
      }
      if (accept("kw", "если")) return ifRest(line);
      if (accept("kw", "пока")) {
        const cond = expr();
        endLine();
        const body = block(["конец"]);
        next();
        endLine();
        return { k: "while", cond, body, line };
      }
      if (accept("kw", "повторить")) {
        const count = expr();
        expect("kw", "раз");
        endLine();
        const body = block(["конец"]);
        next();
        endLine();
        return { k: "repeat", count, body, line };
      }
      if (accept("kw", "для")) {
        expect("kw", "каждого");
        const name = expect("id", undefined, "имя переменной").v;
        expect("kw", "из");
        const list = expr();
        endLine();
        const body = block(["конец"]);
        next();
        endLine();
        return { k: "for", name, list, body, line };
      }
      if (accept("kw", "функция")) {
        const name = expect("id", undefined, "имя функции").v;
        const params = [];
        expect("op", "(");
        if (!is("op", ")")) {
          params.push(expect("id", undefined, "имя параметра").v);
          while (accept("op", ",")) params.push(expect("id", undefined, "имя параметра").v);
        }
        expect("op", ")");
        endLine();
        const body = block(["конец"]);
        next();
        endLine();
        return { k: "func", name, params, body, line };
      }
      if (accept("kw", "верни")) {
        const value = is("nl") ? { k: "lit", v: null } : expr();
        endLine();
        return { k: "return", value, line };
      }
      if (accept("kw", "стоп")) { endLine(); return { k: "break", line }; }
      if (is("id") && tokens[p + 1].t === "op" && tokens[p + 1].v === "=") {
        const name = next().v;
        next();
        const value = expr();
        endLine();
        return { k: "set", name, value, line };
      }
      const e = expr();
      if (accept("op", "=")) {
        if (e.k !== "index") throw new LangError("слева от «=» должна быть переменная", line);
        const value = expr();
        endLine();
        return { k: "setIndex", target: e, value, line };
      }
      endLine();
      return { k: "expr", e, line };
    }

    function ifRest(line) {
      const cond = expr();
      expect("kw", "то");
      endLine();
      const body = block(["иначе", "конец"]);
      let alt = null;
      if (accept("kw", "иначе")) {
        if (accept("kw", "если")) {
          alt = [ifRest(peek().line)];
          return { k: "if", cond, body, alt, line };
        }
        endLine();
        alt = block(["конец"]);
      }
      expect("kw", "конец");
      endLine();
      return { k: "if", cond, body, alt, line };
    }

    function expr() { return orExpr(); }
    function orExpr() {
      let l = andExpr();
      while (is("kw", "или")) { const line = next().line; l = { k: "bin", op: "или", l, r: andExpr(), line }; }
      return l;
    }
    function andExpr() {
      let l = notExpr();
      while (is("kw", "и")) { const line = next().line; l = { k: "bin", op: "и", l, r: notExpr(), line }; }
      return l;
    }
    function notExpr() {
      if (is("kw", "не")) { const line = next().line; return { k: "not", e: notExpr(), line }; }
      return cmp();
    }
    function cmp() {
      let l = add();
      while (is("op") && ["==", "!=", "<", ">", "<=", ">="].includes(peek().v)) {
        const t = next();
        l = { k: "bin", op: t.v, l, r: add(), line: t.line };
      }
      return l;
    }
    function add() {
      let l = mul();
      while (is("op", "+") || is("op", "-")) { const t = next(); l = { k: "bin", op: t.v, l, r: mul(), line: t.line }; }
      return l;
    }
    function mul() {
      let l = unary();
      while (is("op", "*") || is("op", "/") || is("op", "%")) { const t = next(); l = { k: "bin", op: t.v, l, r: unary(), line: t.line }; }
      return l;
    }
    function unary() {
      if (is("op", "-")) { const line = next().line; return { k: "neg", e: unary(), line }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (is("op", "(")) {
          const line = next().line;
          const args = [];
          if (!is("op", ")")) {
            args.push(expr());
            while (accept("op", ",")) args.push(expr());
          }
          expect("op", ")");
          e = { k: "call", fn: e, args, line };
        } else if (is("op", "[")) {
          const line = next().line;
          const index = expr();
          expect("op", "]");
          e = { k: "index", obj: e, index, line };
        } else return e;
      }
    }
    function primary() {
      const t = next();
      if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
      if (t.t === "kw" && t.v === "истина") return { k: "lit", v: true };
      if (t.t === "kw" && t.v === "ложь") return { k: "lit", v: false };
      if (t.t === "kw" && t.v === "ничего") return { k: "lit", v: null };
      if (t.t === "id") return { k: "var", name: t.v, line: t.line };
      if (t.t === "op" && t.v === "(") { const e = expr(); expect("op", ")"); return e; }
      if (t.t === "op" && t.v === "[") {
        const items = [];
        if (!is("op", "]")) {
          items.push(expr());
          while (accept("op", ",")) items.push(expr());
        }
        expect("op", "]");
        return { k: "list", items };
      }
      throw new LangError("ожидалось значение, а встретилось " + describe(t), t.line);
    }

    const program = [];
    skipNl();
    while (!is("eof")) { program.push(statement()); skipNl(); }
    return program;
  }

  function show(v) {
    if (v === null || v === undefined) return "ничего";
    if (v === true) return "истина";
    if (v === false) return "ложь";
    if (Array.isArray(v)) return "[" + v.map(show).join(", ") + "]";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10).replace(".", ",");
    if (typeof v === "function" || (v && v.userFn)) return "<функция>";
    return String(v);
  }

  class Scope {
    constructor(parent) { this.vars = new Map(); this.parent = parent; }
    find(name) {
      let s = this;
      while (s) { if (s.vars.has(name)) return s; s = s.parent; }
      return null;
    }
  }

  const RETURN = Symbol("return");
  const BREAK = Symbol("break");

  function run(src, io) {
    io = io || {};
    const out = [];
    const write = io.write || ((s) => out.push(s));
    const ask = io.ask || (() => "");
    const maxSteps = io.maxSteps || 5000000;
    let steps = 0;
    const program = parse(src);
    const global = new Scope(null);

    const num = (v, line, what) => {
      if (typeof v !== "number" || Number.isNaN(v)) throw new LangError((what || "значение") + " должно быть числом, а не «" + show(v) + "»", line);
      return v;
    };
    const builtins = {
      "спроси": (q) => {
        const ans = ask(q === undefined ? "" : show(q));
        const s = ans === null || ans === undefined ? "" : String(ans);
        return s;
      },
      "число": (s) => {
        const n = parseFloat(String(s).replace(",", "."));
        if (Number.isNaN(n)) throw new LangError("«" + show(s) + "» не похоже на число");
        return n;
      },
      "строка": (v) => show(v),
      "длина": (v) => (Array.isArray(v) || typeof v === "string" ? v.length : 0),
      "добавь": (list, v) => { if (!Array.isArray(list)) throw new LangError("добавлять можно только в список"); list.push(v); return list; },
      "убери": (list, i) => { if (!Array.isArray(list)) throw new LangError("убирать можно только из списка"); return list.splice(i, 1)[0]; },
      "случайное": (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
      "округли": (v) => Math.round(v),
      "корень": (v) => Math.sqrt(v),
      "модуль": (v) => Math.abs(v),
      "большими": (s) => String(s).toUpperCase(),
      "маленькими": (s) => String(s).toLowerCase(),
      "соедини": (list, sep) => list.map(show).join(sep === undefined ? "" : show(sep)),
      "от": (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; },
    };
    for (const k in builtins) global.vars.set(k, builtins[k]);

    function exec(body, scope) {
      for (const st of body) {
        const r = execOne(st, scope);
        if (r) return r;
      }
      return null;
    }

    function tick(line) {
      if (++steps > maxSteps) throw new LangError("программа работает слишком долго — может, цикл никогда не кончается?", line);
    }

    function execOne(st, scope) {
      tick(st.line);
      switch (st.k) {
        case "let": scope.vars.set(st.name, ev(st.value, scope)); return null;
        case "set": {
          const s = scope.find(st.name);
          if (!s) throw new LangError("переменная «" + st.name + "» ещё не создана — напиши «пусть " + st.name + " = …»", st.line);
          s.vars.set(st.name, ev(st.value, scope));
          return null;
        }
        case "setIndex": {
          const obj = ev(st.target.obj, scope);
          const i = num(ev(st.target.index, scope), st.line, "номер");
          if (!Array.isArray(obj)) throw new LangError("изменять по номеру можно только список", st.line);
          obj[i] = ev(st.value, scope);
          return null;
        }
        case "print": write(st.items.map((e) => show(ev(e, scope))).join(" ")); return null;
        case "if":
          if (truthy(ev(st.cond, scope))) return exec(st.body, new Scope(scope));
          if (st.alt) return exec(st.alt, new Scope(scope));
          return null;
        case "while":
          while (truthy(ev(st.cond, scope))) {
            tick(st.line);
            const r = exec(st.body, new Scope(scope));
            if (r === BREAK) break;
            if (r) return r;
          }
          return null;
        case "repeat": {
          const n = num(ev(st.count, scope), st.line, "число повторов");
          for (let i = 0; i < n; i++) {
            const r = exec(st.body, new Scope(scope));
            if (r === BREAK) break;
            if (r) return r;
          }
          return null;
        }
        case "for": {
          const list = ev(st.list, scope);
          const items = typeof list === "string" ? list.split("") : list;
          if (!Array.isArray(items)) throw new LangError("перебирать можно список или строку", st.line);
          for (const item of items.slice()) {
            const s = new Scope(scope);
            s.vars.set(st.name, item);
            const r = exec(st.body, s);
            if (r === BREAK) break;
            if (r) return r;
          }
          return null;
        }
        case "func": scope.vars.set(st.name, { userFn: true, params: st.params, body: st.body, closure: scope, name: st.name }); return null;
        case "return": return { [RETURN]: true, v: ev(st.value, scope) };
        case "break": return BREAK;
        case "expr": ev(st.e, scope); return null;
      }
      return null;
    }

    function truthy(v) { return !(v === false || v === null || v === undefined || v === 0 || v === ""); }

    function eq(a, b) {
      if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
      return a === b;
    }

    function ev(e, scope) {
      switch (e.k) {
        case "lit": return e.v;
        case "list": return e.items.map((x) => ev(x, scope));
        case "var": {
          const s = scope.find(e.name);
          if (!s) throw new LangError("не знаю, что такое «" + e.name + "»", e.line);
          return s.vars.get(e.name);
        }
        case "neg": return -num(ev(e.e, scope), e.line);
        case "not": return !truthy(ev(e.e, scope));
        case "index": {
          const obj = ev(e.obj, scope);
          const i = num(ev(e.index, scope), e.line, "номер");
          if (!Array.isArray(obj) && typeof obj !== "string") throw new LangError("брать по номеру можно только из списка или строки", e.line);
          if (i < 0 || i >= obj.length) throw new LangError("нет элемента с номером " + i + " (всего " + obj.length + ", счёт с 0)", e.line);
          return obj[i];
        }
        case "bin": {
          if (e.op === "и") { const l = ev(e.l, scope); return truthy(l) ? truthy(ev(e.r, scope)) : false; }
          if (e.op === "или") { const l = ev(e.l, scope); return truthy(l) ? true : truthy(ev(e.r, scope)); }
          const a = ev(e.l, scope);
          const b = ev(e.r, scope);
          switch (e.op) {
            case "+":
              if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
              if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
              return num(a, e.line) + num(b, e.line);
            case "-": return num(a, e.line) - num(b, e.line);
            case "*":
              if (typeof a === "string" && typeof b === "number") return a.repeat(Math.max(0, b));
              return num(a, e.line) * num(b, e.line);
            case "/":
              if (num(b, e.line) === 0) throw new LangError("делить на ноль нельзя", e.line);
              return num(a, e.line) / b;
            case "%":
              if (num(b, e.line) === 0) throw new LangError("делить на ноль нельзя", e.line);
              return num(a, e.line) % b;
            case "==": return eq(a, b);
            case "!=": return !eq(a, b);
            case "<": return a < b;
            case ">": return a > b;
            case "<=": return a <= b;
            case ">=": return a >= b;
          }
          return null;
        }
        case "call": {
          const f = ev(e.fn, scope);
          const args = e.args.map((x) => ev(x, scope));
          if (typeof f === "function") {
            try { return f(...args); } catch (err) {
              if (err instanceof LangError && !err.line) throw new LangError(err.message, e.line);
              throw err;
            }
          }
          if (f && f.userFn) {
            if (args.length !== f.params.length) throw new LangError("функция «" + f.name + "» ждёт " + f.params.length + " знач., а получила " + args.length, e.line);
            const s = new Scope(f.closure);
            f.params.forEach((p, i) => s.vars.set(p, args[i]));
            const r = exec(f.body, s);
            return r && r[RETURN] ? r.v : null;
          }
          throw new LangError("это не функция: «" + show(f) + "»", e.line);
        }
      }
      return null;
    }

    exec(program, global);
    return out;
  }

  const api = { run, parse, tokenize, show, LangError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ponyatny = api;
})(typeof window !== "undefined" ? window : globalThis);

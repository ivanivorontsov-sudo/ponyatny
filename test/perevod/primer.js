function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
class Counter {
  constructor(start = 0) { this.value = start; }
  inc() { this.value++; return this; }
  toString() { return `Счётчик: ${this.value}`; }
}
const c = new Counter(5);
c.inc().inc();
console.log(String(c));
let list = [];
for (let i = 0; i < 6; i++) {
  list.push(fib(i));
}
console.log(list.join(", "), list.length);
const user = { name: "Ваня", age: 20 };
for (const [k, v] of Object.entries(user)) console.log(k, v);
let s = 0;
for (const x of list) { if (x % 2 === 0) continue; s += x; }
console.log("Нечётная сумма", s);
const doubled = list.map(x => x * 2).filter(x => x > 2);
console.log(doubled.join(" "));
switch (s) {
  case 1: console.log("один"); break;
  case 7: case 8: console.log("семь или восемь"); break;
  default: console.log("другое");
}
try { throw new Error("ой"); } catch (e) { console.log("Поймал", e.message); }
let n = 10;
while (n > 0) { n -= 3; }
console.log(n, n > 0 ? "плюс" : "минус", "abc".toUpperCase());

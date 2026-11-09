class Животное {
  static count = 0;
  #тайна = 1;
  constructor(имя) { this.имя = имя; Животное.count += 1; }
  get описание() { return "животное " + this.имя; }
  static сколько() { return Животное.count; }
  голос() { return "..."; }
}
class Кот extends Животное {
  голос() { return "мяу"; }
}
const к = new Кот("Барсик");
console.log(к.голос(), к.описание, Животное.сколько(), к instanceof Животное);
let i = 0;
do { i += 2; } while (i < 5);
console.log(i);
let [a, b] = [1, 2];
[a, b] = [b, a];
console.log(a, b);
console.log(6 & 3, 6 | 1, 6 ^ 3, 1 << 4, -16 >> 2, ~0, Math.floor(-3.5), Math.ceil(3.2));
let m = 5;
m <<= 1;
m ^= 3;
console.log(m);
switch (m) {
  case 9: console.log("девять"); break;
  default: console.log("другое");
}
console.log(String.fromCharCode(1046), JSON.stringify({ x: [1, 2] }));
console.error("в поток ошибок");

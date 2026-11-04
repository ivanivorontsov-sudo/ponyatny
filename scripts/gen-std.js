// собирает src/biblioteka/*.pon в src/std.js — стандартная библиотека встроена в компилятор (подключи "стд/…")
const fs=require('fs'),path=require('path'); const d=path.join(__dirname,'..','src','biblioteka'); const m={};
for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.pon')).sort()) m[f.replace(/\.pon$/,'')]=fs.readFileSync(path.join(d,f),'utf8');
fs.writeFileSync(path.join(__dirname,'..','src','std.js'),'module.exports = '+JSON.stringify(m,null,0)+';\n');
console.log('стд:',Object.keys(m).join(', '));

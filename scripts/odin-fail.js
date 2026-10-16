const fs = require("fs");
const path = require("path");
const pub = path.join(__dirname, "..", "public");
let html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
for (const f of ["acorn.js", "yadro.js", "perevod-iz.js", "perevod-v.js"]) {
  const js = fs.readFileSync(path.join(pub, f), "utf8").replace(/<\/script/gi, "<\\/script");
  html = html.replace("<script src=\"" + f + "\"></script>", () => "<script>\n" + js + "\n</script>");
}
const ex = {};
for (const f of fs.readdirSync(path.join(pub, "primery"))) ex[f] = fs.readFileSync(path.join(pub, "primery", f), "utf8");
html = html.replace("<script>\nconst Y = PonyatnyYadro;", () => "<script>\nconst ВСТРОЕННЫЕ_ПРИМЕРЫ = " + JSON.stringify(ex).replace(/<\//g, "<\\/") + ";\nconst Y = PonyatnyYadro;");
html = html.replace("fetch(\"primery/\" + f).then((r) => r.text())", "Promise.resolve(ВСТРОЕННЫЕ_ПРИМЕРЫ[f])");
fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "build", "index.html"), html);

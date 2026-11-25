"use strict";
// Запись исполняемых файлов: ELF (Linux x86-64, динамический — только чтобы загрузить системную libc)
// и PE32+ (Windows x64). Вход: машинный код, данные, список импортов, точка входа.
const align = (x, a) => Math.ceil(x / a) * a;
class W {
  constructor() { this.b = []; }
  get pos() { return this.b.length; }
  u8(x) { this.b.push(x & 255); }
  u16(x) { this.u8(x); this.u8(x >> 8); }
  u32(x) { x >>>= 0; this.u8(x); this.u8(x >> 8); this.u8(x >> 16); this.u8(x >>> 24); }
  u64(x) { let v = BigInt.asUintN(64, BigInt(x)); for (let i = 0; i < 8; i++) { this.u8(Number(v & 255n)); v >>= 8n; } }
  bytes(a) { for (const x of a) this.b.push(x & 255); }
  str(s) { this.bytes(Buffer.from(s, "utf8")); this.u8(0); }
  pad(to) { while (this.b.length < to) this.b.push(0); }
  set32(at, x) { x >>>= 0; this.b[at] = x & 255; this.b[at + 1] = (x >> 8) & 255; this.b[at + 2] = (x >> 16) & 255; this.b[at + 3] = (x >>> 24) & 255; }
  set64(at, x) { let v = BigInt.asUintN(64, BigInt(x)); for (let i = 0; i < 8; i++) { this.b[at + i] = Number(v & 255n); v >>= 8n; } }
}
function patch(text, ext, textAddr, symAddr) {
  for (const f of ext) {
    const dest = symAddr(f.target);
    const rel = dest - (textAddr + f.end);
    if (rel > 0x7fffffff || rel < -0x80000000) throw new Error("слишком далёкий переход");
    text[f.at] = rel & 255; text[f.at + 1] = (rel >> 8) & 255; text[f.at + 2] = (rel >> 16) & 255; text[f.at + 3] = (rel >>> 24) & 255;
  }
}

const ELF_LIBS = { c: "libc.so.6", m: "libm.so.6", dl: "libdl.so.2" };
function writeElf(img) {
  const BASE = 0x400000;
  const imports = img.imports; // [{lib, name}]
  const libs = [...new Set(imports.map((i) => ELF_LIBS[i.lib] || i.lib))];
  const w = new W();
  const NPH = 6;
  const ehdr = 0, phoff = 64;
  w.pad(64 + NPH * 56);
  const interpOff = w.pos; w.str("/lib64/ld-linux-x86-64.so.2");
  // dynstr
  const dynstrOff = w.pos; w.u8(0);
  const libName = libs.map((l) => { const p = w.pos - dynstrOff; w.str(l); return p; });
  const symName = imports.map((i) => { const p = w.pos - dynstrOff; w.str(i.name); return p; });
  const dynstrSize = w.pos - dynstrOff;
  w.pad(align(w.pos, 8));
  const dynsymOff = w.pos;
  w.pad(w.pos + 24);
  for (let i = 0; i < imports.length; i++) { w.u32(symName[i]); w.u8(0x12); w.u8(0); w.u16(0); w.u64(0); w.u64(0); }
  const hashOff = w.pos;
  const nsym = imports.length + 1;
  w.u32(1); w.u32(nsym); w.u32(0); for (let i = 0; i < nsym; i++) w.u32(0);
  w.pad(align(w.pos, 8));
  const relaOff = w.pos;
  const relaFix = [];
  for (let i = 0; i < imports.length; i++) { relaFix.push(w.pos); w.u64(0); w.u64((BigInt(i + 1) << 32n) | 6n); w.u64(0); }
  const relaSize = w.pos - relaOff;
  w.pad(align(w.pos, 16));
  const textOff = w.pos;
  w.bytes(img.text);
  const rxEnd = w.pos;
  w.pad(align(w.pos, 0x1000));
  const rwOff = w.pos;
  const dynOff = w.pos;
  const dyn = [];
  for (const p of libName) dyn.push([1, p]);
  dyn.push([4, BASE + hashOff], [5, BASE + dynstrOff], [6, BASE + dynsymOff], [7, BASE + relaOff], [8, relaSize], [9, 24], [10, dynstrSize], [11, 24], [30, 8], [21, 0], [0, 0]);
  for (const [t, v] of dyn) { w.u64(t); w.u64(v); }
  const gotOff = w.pos;
  for (let i = 0; i < imports.length; i++) w.u64(0);
  w.pad(align(w.pos, 16));
  const dataOff = w.pos;
  w.bytes(img.data);
  const fileEnd = w.pos;
  const memEnd = fileEnd + (img.bss || 0);
  for (let i = 0; i < imports.length; i++) w.set64(relaFix[i], BASE + gotOff + 8 * i);
  const symAddr = (t) => {
    if (t.data != null) return BASE + dataOff + t.data;
    if (t.imp != null) return BASE + gotOff + 8 * t.imp;
    throw new Error("неизвестная цель");
  };
  const t2 = img.text.slice();
  patch(t2, img.ext, BASE + textOff, symAddr);
  for (let i = 0; i < t2.length; i++) w.b[textOff + i] = t2[i];
  // заголовок ELF
  const h = new W();
  h.bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]); h.pad(16);
  h.u16(2); h.u16(0x3e); h.u32(1); h.u64(BASE + textOff + img.entry); h.u64(phoff); h.u64(0);
  h.u32(0); h.u16(64); h.u16(56); h.u16(NPH); h.u16(64); h.u16(0); h.u16(0);
  const ph = (type, flags, off, filesz, memsz, al) => { h.u32(type); h.u32(flags); h.u64(off); h.u64(BASE + off); h.u64(BASE + off); h.u64(filesz); h.u64(memsz); h.u64(al); };
  ph(6, 4, phoff, NPH * 56, NPH * 56, 8);
  ph(3, 4, interpOff, 28, 28, 1);
  ph(1, 5, 0, rxEnd, rxEnd, 0x1000);
  ph(1, 6, rwOff, fileEnd - rwOff, memEnd - rwOff, 0x1000);
  ph(2, 6, dynOff, dyn.length * 16, dyn.length * 16, 8);
  h.u32(0x6474e551); h.u32(6); h.pad(h.pos + 48);
  for (let i = 0; i < h.b.length; i++) w.b[i] = h.b[i];
  return Buffer.from(w.b);
}

const PE_LIBS = { c: "msvcrt.dll", m: "msvcrt.dll", kernel32: "kernel32.dll", shell32: "shell32.dll" };
function writePe(img, opts) {
  opts = opts || {};
  const BASE = 0x140000000n;
  const SA = 0x1000, FA = 0x200;
  const NSEC = 3;
  const hdrSize = align(0x40 + 4 + 20 + 240 + NSEC * 40, FA);
  const textRva = SA, textRaw = align(img.text.length, FA);
  // .idata (импорты) в отдельной секции
  const byLib = new Map();
  img.imports.forEach((imp, i) => { const l = PE_LIBS[imp.lib] || imp.lib; if (!byLib.has(l)) byLib.set(l, []); byLib.get(l).push({ name: imp.name, i }); });
  const idataRva = align(textRva + img.text.length, SA);
  const iw = new W();
  const libsArr = [...byLib.keys()];
  const descOff = 0; iw.pad((libsArr.length + 1) * 20);
  const iatSlot = new Array(img.imports.length);
  const lookups = [];
  for (const l of libsArr) {
    const items = byLib.get(l);
    const ilt = iw.pos; iw.pad(iw.pos + (items.length + 1) * 8);
    const iat = iw.pos; iw.pad(iw.pos + (items.length + 1) * 8);
    items.forEach((it, k) => { iatSlot[it.i] = iat + 8 * k; });
    lookups.push({ l, items, ilt, iat });
  }
  for (const lk of lookups) {
    lk.nameOff = iw.pos; iw.str(lk.l); if (iw.pos & 1) iw.u8(0);
    lk.hn = lk.items.map((it) => { const p = iw.pos; iw.u16(0); iw.str(it.name); if (iw.pos & 1) iw.u8(0); return p; });
  }
  lookups.forEach((lk, j) => {
    const d = descOff + j * 20;
    iw.set32(d, idataRva + lk.ilt); iw.set32(d + 12, idataRva + lk.nameOff); iw.set32(d + 16, idataRva + lk.iat);
    lk.hn.forEach((p, k) => { iw.set64(lk.ilt + 8 * k, idataRva + p); iw.set64(lk.iat + 8 * k, idataRva + p); });
  });
  const iatStart = Math.min(...lookups.map((l) => l.iat)), iatEnd = Math.max(...lookups.map((l) => l.iat + (l.items.length + 1) * 8));
  const idataSize = iw.pos, idataRaw = align(idataSize, FA);
  const dataRva = align(idataRva + idataSize, SA);
  const dataSize = img.data.length, dataRaw = align(dataSize, FA), dataVSize = dataSize + (img.bss || 0);
  const imageSize = align(dataRva + Math.max(dataVSize, 1), SA);
  const text = img.text.slice();
  patch(text, img.ext, textRva, (t) => { if (t.data != null) return dataRva + t.data; if (t.imp != null) return idataRva + iatSlot[t.imp]; throw new Error("неизвестная цель"); });
  const w = new W();
  w.bytes([0x4d, 0x5a]); w.pad(0x3c); w.u32(0x40);
  w.bytes([0x50, 0x45, 0, 0]);
  w.u16(0x8664); w.u16(NSEC); w.u32(0); w.u32(0); w.u32(0); w.u16(240); w.u16(0x0023);
  w.u16(0x20b); w.u8(14); w.u8(0); w.u32(textRaw); w.u32(idataRaw + dataRaw); w.u32(0); w.u32(textRva + img.entry); w.u32(textRva);
  w.u64(BASE); w.u32(SA); w.u32(FA); w.u16(6); w.u16(0); w.u16(0); w.u16(0); w.u16(6); w.u16(0); w.u32(0);
  w.u32(imageSize); w.u32(hdrSize); w.u32(0); w.u16(opts.gui ? 2 : 3); w.u16(0x8100);
  w.u64(0x10000000); w.u64(0x100000); w.u64(0x100000); w.u64(0x1000); w.u32(0); w.u32(16);
  for (let i = 0; i < 16; i++) {
    if (i === 1) { w.u32(idataRva); w.u32((libsArr.length + 1) * 20); }
    else if (i === 12) { w.u32(idataRva + iatStart); w.u32(iatEnd - iatStart); }
    else { w.u32(0); w.u32(0); }
  }
  const sec = (name, vsize, rva, raw, rawPtr, ch) => { const n = Buffer.alloc(8); n.write(name); w.bytes(n); w.u32(vsize); w.u32(rva); w.u32(raw); w.u32(rawPtr); w.u32(0); w.u32(0); w.u16(0); w.u16(0); w.u32(ch); };
  const textPtr = hdrSize, idataPtr = textPtr + textRaw, dataPtr = idataPtr + idataRaw;
  sec(".text", img.text.length, textRva, textRaw, textPtr, 0x60000020);
  sec(".idata", idataSize, idataRva, idataRaw, idataPtr, 0xC0000040);
  sec(".data", dataVSize, dataRva, dataRaw, dataPtr, 0xC0000040);
  w.pad(textPtr); w.bytes(text); w.pad(idataPtr); w.bytes(iw.b); w.pad(dataPtr); w.bytes(img.data); w.pad(dataPtr + dataRaw);
  return Buffer.from(w.b);
}
module.exports = { writeElf, writePe };

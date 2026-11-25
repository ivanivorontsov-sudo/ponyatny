"use strict";
// Ассемблер x86-64 для нативного бэкенда «Понятного»: кодирует нужные инструкции в байты.
// Регистры: 0 rax, 1 rcx, 2 rdx, 3 rbx, 4 rsp, 5 rbp, 6 rsi, 7 rdi, 8..15 r8..r15. XMM — 0..15.
const R = { rax: 0, rcx: 1, rdx: 2, rbx: 3, rsp: 4, rbp: 5, rsi: 6, rdi: 7, r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15 };
const CC = { o: 0, no: 1, b: 2, ae: 3, e: 4, ne: 5, be: 6, a: 7, s: 8, ns: 9, p: 10, np: 11, l: 12, ge: 13, le: 14, g: 15 };

class Asm {
  constructor() { this.b = []; this.fix = []; this.ext = []; }
  get pos() { return this.b.length; }
  label() { return { pos: null }; }
  bind(l) { l.pos = this.b.length; }
  byte(x) { this.b.push(x & 255); }
  bytes(a) { for (const x of a) this.b.push(x & 255); }
  d32(x) { x = x | 0; this.b.push(x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255); }
  d64(big) { let v = BigInt.asUintN(64, BigInt(big)); for (let i = 0; i < 8; i++) { this.b.push(Number(v & 255n)); v >>= 8n; } }
  rex(w, r, x, b, force) { const v = 0x40 | (w ? 8 : 0) | (r & 8 ? 4 : 0) | (x & 8 ? 2 : 0) | (b & 8 ? 1 : 0); if (v !== 0x40 || force) this.byte(v); }
  // ModRM с памятью [base + disp]
  mem(reg, base, disp) {
    reg &= 7;
    const b = base & 7;
    if (disp === 0 && b !== 5) { this.byte((reg << 3) | b); if (b === 4) this.byte(0x24); }
    else if (disp >= -128 && disp <= 127) { this.byte(0x40 | (reg << 3) | b); if (b === 4) this.byte(0x24); this.byte(disp); }
    else { this.byte(0x80 | (reg << 3) | b); if (b === 4) this.byte(0x24); this.d32(disp); }
  }
  // [base + index*8 + disp]
  memIdx(reg, base, index, disp) {
    reg &= 7;
    const b = base & 7, x = index & 7;
    if (disp === 0 && b !== 5) { this.byte(0x04 | (reg << 3)); this.byte(0xC0 | (x << 3) | b); }
    else if (disp >= -128 && disp <= 127) { this.byte(0x44 | (reg << 3)); this.byte(0xC0 | (x << 3) | b); this.byte(disp); }
    else { this.byte(0x84 | (reg << 3)); this.byte(0xC0 | (x << 3) | b); this.d32(disp); }
  }
  rr(op, dst, src, w = 1) { this.rex(w, src, 0, dst); this.bytes(op); this.byte(0xC0 | ((src & 7) << 3) | (dst & 7)); }
  // mov dst, src
  mov(dst, src) { if (dst !== src) this.rr([0x89], dst, src); }
  movImm(dst, v) {
    v = BigInt.asIntN(64, BigInt(v));
    if (v === 0n) { this.rr([0x31], dst, dst, 0); return; }
    if (v > 0n && v < 0x100000000n) { this.rex(0, 0, 0, dst); this.byte(0xB8 + (dst & 7)); this.d32(Number(v)); return; }
    if (v >= -0x80000000n && v < 0n) { this.rex(1, 0, 0, dst); this.byte(0xC7); this.byte(0xC0 | (dst & 7)); this.d32(Number(v)); return; }
    this.rex(1, 0, 0, dst); this.byte(0xB8 + (dst & 7)); this.d64(v);
  }
  load(dst, base, disp = 0) { this.rex(1, dst, 0, base); this.byte(0x8B); this.mem(dst, base, disp); }
  store(base, disp, src) { this.rex(1, src, 0, base); this.byte(0x89); this.mem(src, base, disp); }
  loadIdx(dst, base, index, disp = 0) { this.rex(1, dst, index, base); this.byte(0x8B); this.memIdx(dst, base, index, disp); }
  storeIdx(base, index, disp, src) { this.rex(1, src, index, base); this.byte(0x89); this.memIdx(src, base, index, disp); }
  load8(dst, base, disp = 0) { this.rex(1, dst, 0, base); this.bytes([0x0F, 0xB6]); this.mem(dst, base, disp); }
  load16(dst, base, disp = 0) { this.rex(1, dst, 0, base); this.bytes([0x0F, 0xB7]); this.mem(dst, base, disp); }
  load32(dst, base, disp = 0) { this.rex(0, dst, 0, base); this.byte(0x8B); this.mem(dst, base, disp); }
  load32s(dst, base, disp = 0) { this.rex(1, dst, 0, base); this.byte(0x63); this.mem(dst, base, disp); }
  store8(base, disp, src) { this.rex(0, src, 0, base, src >= 4); this.byte(0x88); this.mem(src, base, disp); }
  store16(base, disp, src) { this.byte(0x66); this.rex(0, src, 0, base); this.byte(0x89); this.mem(src, base, disp); }
  store32(base, disp, src) { this.rex(0, src, 0, base); this.byte(0x89); this.mem(src, base, disp); }
  lea(dst, base, disp) { this.rex(1, dst, 0, base); this.byte(0x8D); this.mem(dst, base, disp); }
  // RIP-относительные: sym — {label} внутри кода или {sym, add} во внешних секциях
  ripOp(prefix, op, reg, target) {
    if (prefix) this.bytes(prefix);
    this.rex(1, reg, 0, 0); this.bytes(op); this.byte(((reg & 7) << 3) | 5);
    const at = this.pos; this.d32(0);
    this.fix.push({ at, target, end: this.pos });
  }
  leaRip(dst, target) { this.ripOp(null, [0x8D], dst, target); }
  loadRip(dst, target) { this.ripOp(null, [0x8B], dst, target); }
  storeRip(target, src) { this.ripOp(null, [0x89], src, target); }
  callRip(target) { this.byte(0xFF); this.byte(0x15); const at = this.pos; this.d32(0); this.fix.push({ at, target, end: this.pos }); }
  alu(kind, dst, src) { const op = { add: 0x01, or: 0x09, and: 0x21, sub: 0x29, xor: 0x31, cmp: 0x39, test: 0x85 }[kind]; this.rr([op], dst, src); }
  aluImm(kind, dst, imm) {
    const ext = { add: 0, or: 1, and: 4, sub: 5, xor: 6, cmp: 7 }[kind];
    this.rex(1, 0, 0, dst);
    if (imm >= -128 && imm <= 127) { this.byte(0x83); this.byte(0xC0 | (ext << 3) | (dst & 7)); this.byte(imm); }
    else { this.byte(0x81); this.byte(0xC0 | (ext << 3) | (dst & 7)); this.d32(imm); }
  }
  imul(dst, src) { this.rex(1, dst, 0, src); this.bytes([0x0F, 0xAF]); this.byte(0xC0 | ((dst & 7) << 3) | (src & 7)); }
  cqo() { this.bytes([0x48, 0x99]); }
  idiv(src) { this.rex(1, 0, 0, src); this.byte(0xF7); this.byte(0xF8 | (src & 7)); }
  neg(r) { this.rex(1, 0, 0, r); this.byte(0xF7); this.byte(0xD8 | (r & 7)); }
  not(r) { this.rex(1, 0, 0, r); this.byte(0xF7); this.byte(0xD0 | (r & 7)); }
  shiftCl(kind, r) { const ext = { shl: 4, shr: 5, sar: 7 }[kind]; this.rex(1, 0, 0, r); this.byte(0xD3); this.byte(0xC0 | (ext << 3) | (r & 7)); }
  shiftImm(kind, r, n) { const ext = { shl: 4, shr: 5, sar: 7 }[kind]; this.rex(1, 0, 0, r); this.byte(0xC1); this.byte(0xC0 | (ext << 3) | (r & 7)); this.byte(n); }
  setcc(cc, r) { this.rex(0, 0, 0, r, r >= 4); this.bytes([0x0F, 0x90 + CC[cc]]); this.byte(0xC0 | (r & 7)); this.rex(1, r, 0, r); this.bytes([0x0F, 0xB6]); this.byte(0xC0 | ((r & 7) << 3) | (r & 7)); }
  movsxd(dst, src) { this.rex(1, dst, 0, src); this.byte(0x63); this.byte(0xC0 | ((dst & 7) << 3) | (src & 7)); }
  mov32(dst, src) { this.rr([0x89], dst, src, 0); }
  push(r) { this.rex(0, 0, 0, r); this.byte(0x50 + (r & 7)); }
  pop(r) { this.rex(0, 0, 0, r); this.byte(0x58 + (r & 7)); }
  ret() { this.byte(0xC3); }
  jmp(l) { this.byte(0xE9); const at = this.pos; this.d32(0); this.fix.push({ at, target: { label: l }, end: this.pos }); }
  jcc(cc, l) { this.bytes([0x0F, 0x80 + CC[cc]]); const at = this.pos; this.d32(0); this.fix.push({ at, target: { label: l }, end: this.pos }); }
  call(l) { this.byte(0xE8); const at = this.pos; this.d32(0); this.fix.push({ at, target: { label: l }, end: this.pos }); }
  callR(r) { this.rex(0, 0, 0, r); this.byte(0xFF); this.byte(0xD0 | (r & 7)); }
  jmpR(r) { this.rex(0, 0, 0, r); this.byte(0xFF); this.byte(0xE0 | (r & 7)); }
  // SSE2
  movqXR(x, r) { this.byte(0x66); this.rex(1, x, 0, r); this.bytes([0x0F, 0x6E]); this.byte(0xC0 | ((x & 7) << 3) | (r & 7)); }
  movqRX(r, x) { this.byte(0x66); this.rex(1, x, 0, r); this.bytes([0x0F, 0x7E]); this.byte(0xC0 | ((x & 7) << 3) | (r & 7)); }
  sse(pfx, op, x, y) { this.byte(pfx); this.rex(0, x, 0, y); this.bytes([0x0F, op]); this.byte(0xC0 | ((x & 7) << 3) | (y & 7)); }
  addsd(x, y) { this.sse(0xF2, 0x58, x, y); }
  subsd(x, y) { this.sse(0xF2, 0x5C, x, y); }
  mulsd(x, y) { this.sse(0xF2, 0x59, x, y); }
  divsd(x, y) { this.sse(0xF2, 0x5E, x, y); }
  sqrtsd(x, y) { this.sse(0xF2, 0x51, x, y); }
  ucomisd(x, y) { this.sse(0x66, 0x2E, x, y); }
  cvtsd2ss(x, y) { this.sse(0xF2, 0x5A, x, y); }
  cvtss2sd(x, y) { this.sse(0xF3, 0x5A, x, y); }
  cvtsi2sd(x, r) { this.byte(0xF2); this.rex(1, x, 0, r); this.bytes([0x0F, 0x2A]); this.byte(0xC0 | ((x & 7) << 3) | (r & 7)); }
  cvttsd2si(r, x) { this.byte(0xF2); this.rex(1, r, 0, x); this.bytes([0x0F, 0x2C]); this.byte(0xC0 | ((r & 7) << 3) | (x & 7)); }
  roundsd(x, y, mode) { this.byte(0x66); this.rex(0, x, 0, y); this.bytes([0x0F, 0x3A, 0x0B]); this.byte(0xC0 | ((x & 7) << 3) | (y & 7)); this.byte(mode); }
  movdXR(x, r) { this.byte(0x66); this.rex(0, x, 0, r); this.bytes([0x0F, 0x6E]); this.byte(0xC0 | ((x & 7) << 3) | (r & 7)); }
  movdRX(r, x) { this.byte(0x66); this.rex(0, x, 0, r); this.bytes([0x0F, 0x7E]); this.byte(0xC0 | ((x & 7) << 3) | (r & 7)); }
  // разрешить переходы внутри кода; внешние цели оставить загрузчику образа
  resolve(external) {
    for (const f of this.fix) {
      let dest;
      if (f.target.label) { if (f.target.label.pos == null) throw new Error("метка не привязана"); dest = f.target.label.pos; }
      else { this.ext.push(f); continue; }
      const rel = dest - f.end;
      this.b[f.at] = rel & 255; this.b[f.at + 1] = (rel >> 8) & 255; this.b[f.at + 2] = (rel >> 16) & 255; this.b[f.at + 3] = (rel >>> 24) & 255;
    }
    return this.ext;
  }
}
module.exports = { Asm, R, CC };

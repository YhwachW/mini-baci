/*
 * Mini BACI: intérprete de C-- (BACI / jBACI) escrito en JavaScript.
 *
 * Cubre lo descrito en el "BACI C-- User's Guide" y el "jBACI User's Guide":
 *   tipos int, char, string[n], arreglos de varias dimensiones, typedef, const,
 *   funciones (valor y referencia, recursión), if/else, switch/case, for, while,
 *   do-while, break, continue, cout, cin, nbcin, #include, casts int() y char(),
 *   cobegin/parbegin, semaphore, binarysem, initialsem, wait/signal (p/v),
 *   monitores (condition, waitc, signalc, empty, init), atomic, suspend, revive,
 *   which_proc, random, funciones de string (stringCopy, stringConcat,
 *   stringCompare, stringLength, sprintf, sscanf), Linda (postnote, readnote,
 *   removenote, readnoteeq, removenoteeq, var=) y gráficos de jBACI
 *   (create, changecolor, makevisible, moveto, moveby).
 */
(function (root) {
'use strict';

const LF = 100000;                 // línea = archivo * LF + línea local
const FLAG_INT = -32767, FLAG_CHAR = 13;
const KW = new Set(['int','void','char','bool','const','semaphore','binarysem','condition','monitor','string','typedef','extern',
  'if','else','while','for','do','switch','case','default','return','cobegin','parbegin','cout','cin','nbcin','endl',
  'break','continue','atomic','true','false']);

class BaciError extends Error { constructor(msg, line) { super(msg); this.line = line; } }
const bErr = (m, l) => new BaciError(m, l);
const isWs = c => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' || c === ' ' || c === '﻿';
const ESC = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v' };
const unesc = e => (e in ESC ? ESC[e] : e);

/* ------------------------------------------------------------------ léxico */
function lex(src, fi) {
  const toks = []; let i = 0, ln = 1; const n = src.length;
  const L = () => fi * LF + ln;
  const ops2 = ['<<','>>','<=','>=','==','!=','&&','||','++','--','+=','-=','*=','/=','%='];
  while (i < n) {
    const c = src[i];
    if (c === '\n') { ln++; i++; continue; }
    if (isWs(c)) { i++; continue; }
    if (c === '/' && src[i+1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i+1] === '*') {
      const start = L(); i += 2;
      while (i < n && !(src[i] === '*' && src[i+1] === '/')) { if (src[i] === '\n') ln++; i++; }
      if (i >= n) throw bErr('Hay un comentario /* que nunca se cierra con */', start);
      i += 2; continue;
    }
    if (c === '#') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      const txt = src.slice(i, j);
      const m = /^#\s*include\s*[<"]([^>"]+)[>"]/.exec(txt);
      if (m) toks.push({ t: '#include', v: m[1].trim(), line: L() });
      else if (/^#\s*include/.test(txt)) throw bErr('#include mal escrito: usa #include "archivo.cm"', L());
      i = j; continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i, v;
      if (c === '0' && (src[i+1] === 'x' || src[i+1] === 'X')) {
        j = i + 2; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        if (j === i + 2) throw bErr('Número hexadecimal incompleto', L());
        v = parseInt(src.slice(i + 2, j), 16);
      } else { while (j < n && src[j] >= '0' && src[j] <= '9') j++; v = parseInt(src.slice(i, j), 10); }
      if (/[A-Za-z_]/.test(src[j] || '')) throw bErr(`Número mal escrito: ${src.slice(i, j + 1)}`, L());
      toks.push({ t: 'num', v, line: L() }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push({ t: KW.has(w) ? w : 'id', v: w, line: L() }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\n') throw bErr('Un texto entre comillas no se cerró (falta ")', L());
        if (src[j] === '\\' && j + 1 < n) { s += unesc(src[j+1]); j += 2; } else s += src[j++];
      }
      if (j >= n) throw bErr('Un texto entre comillas no se cerró (falta ")', L());
      toks.push({ t: 'str', v: s, line: L() }); i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1, ch = src[j];
      const raw = ch;
      if (ch === '\\') { ch = unesc(src[j+1]); j++; }
      j++;
      if (src[j] !== "'" || ch === undefined || raw === '\n') throw bErr("Carácter mal escrito: debe ser como 'a' o '\\n'", L());
      toks.push({ t: 'num', v: ch.charCodeAt(0), line: L(), isChar: true }); i = j + 1; continue;
    }
    const two = src.substr(i, 2);
    if (ops2.includes(two)) { toks.push({ t: two, line: L() }); i += 2; continue; }
    if ('+-*/%<>=!(){}[];,&?:'.includes(c)) { toks.push({ t: c, line: L() }); i++; continue; }
    throw bErr(`Carácter no reconocido: ${c}`, L());
  }
  toks.push({ t: 'eof', line: L() });
  return toks;
}

/* Une el archivo principal con sus #include. resolve(nombre) -> texto o null. */
function lexProgram(mainSrc, resolve, mainName) {
  const files = [mainName || '(principal)'];
  const out = [];
  let lastLine = 1;
  function run(src, fi, stack) {
    const toks = lex(src, fi);
    for (const tk of toks) {
      if (tk.t === 'eof') { if (fi === 0) lastLine = tk.line; continue; }
      if (tk.t !== '#include') { out.push(tk); continue; }
      const key = tk.v.replace(/^.*[\\/]/, '').toLowerCase();
      if (stack.includes(key)) throw bErr(`#include "${tk.v}" se incluye a sí mismo (ciclo de #include)`, tk.line);
      if (stack.length > 8) throw bErr('Demasiados #include anidados', tk.line);
      const text = resolve ? resolve(key) : null;
      if (text == null) throw bErr(`No encuentro el archivo "${tk.v}" del #include. Ábrelo primero con "Abrir" para que quede guardado en la app.`, tk.line);
      files.push(tk.v);
      run(text, files.length - 1, stack.concat(key));
    }
  }
  run(mainSrc, 0, []);
  out.push({ t: 'eof', line: lastLine });
  return { toks: out, files };
}

/* ------------------------------------------------------------- sintaxis */
const LINDA = new Set(['postnote','readnote','removenote','readnoteeq','removenoteeq']);
const LINDA_READ = new Set(['readnote','removenote','readnoteeq','removenoteeq']);
const GFX = new Set(['create','changecolor','makevisible','moveto','moveby']);

function parse(toks, files) {
  let p = 0;
  const typedefs = new Map();
  const prog = { globals: [], funcs: new Map(), monitors: [], protos: new Map(), files: files || ['(principal)'], uses: { input: false, linda: false, gfx: false } };
  const at = t => toks[p].t === t;
  const next = () => toks[p++];
  const accept = t => (toks[p].t === t ? toks[p++] : null);
  const peekT = (k = 1) => toks[Math.min(p + k, toks.length - 1)];
  const desc = tk => tk.t === 'eof' ? 'el final del archivo' : tk.t === 'id' ? `'${tk.v}'` : tk.t === 'num' ? (tk.isChar ? 'un carácter' : `el número ${tk.v}`) : tk.t === 'str' ? 'un texto entre comillas' : KW.has(tk.t) ? `la palabra '${tk.t}'` : `'${tk.t}'`;
  const expect = (t, what) => {
    if (toks[p].t === t) return toks[p++];
    const ln = (t === ';' || t === ')' || t === ']') && p > 0 ? toks[p-1].line : toks[p].line;
    throw bErr(`Se esperaba ${what || `'${t}'`} y se encontró ${desc(toks[p])}`, ln);
  };
  const BASE = new Set(['int','char','bool','void','semaphore','binarysem','condition']);
  const isTypeStart = () => { const tk = toks[p]; return BASE.has(tk.t) || tk.t === 'string' || (tk.t === 'id' && typedefs.has(tk.v)); };
  const isL = e => e.k === 'var' || e.k === 'idx';

  function parseTypeSpec() {
    const tk = toks[p];
    if (tk.t === 'string') { next(); let len = null; if (accept('[')) { len = parseExpr(); expect(']'); } return { base: 'string', strLen: len, dims: [], line: tk.line }; }
    if (BASE.has(tk.t)) { next(); return { base: tk.t === 'bool' ? 'int' : tk.t, strLen: null, dims: [], line: tk.line }; }
    if (tk.t === 'id' && typedefs.has(tk.v)) { next(); const td = typedefs.get(tk.v); return { base: td.base, strLen: td.strLen, dims: td.dims.slice(), line: tk.line }; }
    throw bErr(`Se esperaba un tipo (int, char, string, semaphore...) y se encontró ${desc(tk)}`, tk.line);
  }
  function parseDims() {
    const d = [];
    while (accept('[')) { if (at(']')) throw bErr('Falta el tamaño del arreglo entre [ ]', toks[p].line); d.push(parseExpr()); expect(']'); }
    return d;
  }
  function parseDeclList(ts, isConst) {
    if (ts.base === 'void') throw bErr('Solo las funciones pueden ser void; una variable necesita un tipo como int', ts.line);
    if (ts.base === 'string' && !ts.strLen) throw bErr('Un string necesita su largo: string[20] nombre;', ts.line);
    const out = [];
    do {
      const nm = expect('id', 'el nombre de la variable');
      const dims = parseDims().concat(ts.dims);
      const d = { k: 'decl', base: ts.base, strLen: ts.strLen, dims, name: nm.v, line: nm.line, isConst };
      if (accept('=')) {
        if (dims.length) throw bErr('Un arreglo no se puede inicializar en la declaración; asigna cada posición', nm.line);
        if (ts.base === 'condition') throw bErr('Una condition no tiene valor inicial', nm.line);
        d.init = parseAssign();
      } else if (isConst) throw bErr(`La constante '${nm.v}' necesita un valor: const int ${nm.v} = ...;`, nm.line);
      out.push(d);
    } while (accept(','));
    return out;
  }
  function parseParams() {
    const params = [];
    if (at('void') && peekT().t === ')') { next(); return params; }
    if (at(')')) return params;
    do {
      const ts = parseTypeSpec();
      const amp = !!accept('&');
      const pn = at('id') ? next() : null;
      let isArr = ts.dims.length > 0;
      while (accept('[')) { if (!at(']')) parseExpr(); expect(']'); isArr = true; }
      const byRef = amp || isArr || ['string','semaphore','binarysem','condition'].includes(ts.base);
      params.push({ base: ts.base, name: pn ? pn.v : null, ref: byRef, isArr, line: ts.line });
    } while (accept(','));
    return params;
  }
  function parseFunctionRest(type, nameTk, atomic, monName) {
    next(); // (
    const params = parseParams();
    expect(')');
    if (accept(';')) { prog.protos.set(nameTk.v, nameTk.line); return; }   // prototipo
    params.forEach((pa, i) => { if (!pa.name) throw bErr(`Falta el nombre del parámetro ${i + 1} de ${nameTk.v}()`, pa.line); });
    if (prog.funcs.has(nameTk.v)) throw bErr(`La función '${nameTk.v}' ya estaba definida`, nameTk.line);
    if (monName && nameTk.v === 'main') throw bErr('main() no puede ir dentro de un monitor', nameTk.line);
    if (!at('{')) throw bErr(`Se esperaba '{' con el cuerpo de ${nameTk.v}() y se encontró ${desc(toks[p])}`, toks[p].line);
    const body = parseBlock();
    prog.funcs.set(nameTk.v, { name: nameTk.v, type, params, body, atomic, line: nameTk.line, monitor: monName });
  }
  function parseTopItem(target, monName) {
    if (at('typedef')) {
      next(); const ts = parseTypeSpec(); const nm = expect('id', 'el nombre del tipo');
      const dims = parseDims().concat(ts.dims); expect(';');
      typedefs.set(nm.v, { base: ts.base, strLen: ts.strLen, dims });
      return;
    }
    if (at('id') && toks[p].v === 'main' && peekT().t === '(' && !monName) { const nm = next(); parseFunctionRest('void', nm, false, null); return; }
    let isConst = false, atomic = false;
    for (;;) { if (accept('const')) isConst = true; else if (accept('atomic')) atomic = true; else break; }
    if (!isTypeStart()) throw bErr(`Se esperaba una declaración (int, char, string, void, semaphore${monName ? ', condition' : ', monitor'}...) y se encontró ${desc(toks[p])}`, toks[p].line);
    const ts = parseTypeSpec();
    if (ts.base === 'condition' && !monName) throw bErr('Una variable condition solo puede declararse dentro de un monitor', ts.line);
    const nm = expect('id', 'un nombre');
    if (at('(')) {
      if (ts.dims.length || ts.base === 'string' || ['semaphore','binarysem','condition'].includes(ts.base)) throw bErr(`Una función no puede devolver ${ts.base}`, nm.line);
      parseFunctionRest(ts.base, nm, atomic, monName); return;
    }
    p--;
    target.push(...parseDeclList(ts, isConst));
    expect(';');
  }
  function skipExtern() {
    next();
    if (at('monitor')) {
      next(); accept('id'); expect('{');
      let depth = 1;
      while (depth > 0) { if (at('eof')) throw bErr('extern monitor sin cerrar', toks[p].line); const t = next().t; if (t === '{') depth++; else if (t === '}') depth--; }
      accept(';'); return;
    }
    while (!at(';')) { if (at('eof')) throw bErr('extern sin ;', toks[p].line); next(); }
    next();
  }
  function parseMonitor() {
    const kw = next();
    const name = expect('id', 'el nombre del monitor');
    if (prog.monitors.some(m => m.name === name.v)) throw bErr(`El monitor '${name.v}' ya estaba definido`, name.line);
    const mon = { k: 'monitor', name: name.v, decls: [], init: null, line: kw.line };
    const open = expect('{');
    while (!at('}')) {
      if (at('eof')) throw bErr(`Falta cerrar con '}' el monitor '${name.v}'`, open.line);
      if (at('monitor')) throw bErr('No se puede definir un monitor dentro de otro', toks[p].line);
      if (at(';')) { next(); continue; }
      if (toks[p].t === 'id' && toks[p].v === 'init' && peekT().t === '{') {
        const it = next();
        if (mon.init) throw bErr(`El monitor '${name.v}' ya tiene un bloque init`, it.line);
        mon.init = parseBlock(); continue;
      }
      parseTopItem(mon.decls, mon.name);
    }
    next(); accept(';');
    prog.globals.push(mon); prog.monitors.push(mon);
  }
  function parseBlock() {
    const open = expect('{');
    const body = [];
    while (!at('}')) {
      if (at('eof')) throw bErr(`Falta cerrar con '}' la llave que se abrió aquí`, open.line);
      body.push(parseStmt());
    }
    next();
    return { k: 'block', body, line: open.line };
  }
  function parseStmt() {
    const tk = toks[p];
    if (tk.t === 'const' || (isTypeStart() && !(tk.t === 'id' && peekT().t !== 'id'))) {
      const c = !!accept('const'); const ts = parseTypeSpec();
      if (ts.base === 'condition') throw bErr('Una condition solo se declara en la parte de variables de un monitor', tk.line);
      const decls = parseDeclList(ts, c); expect(';');
      return { k: 'decls', decls, line: tk.line };
    }
    switch (tk.t) {
      case '{': return parseBlock();
      case ';': next(); return { k: 'empty', line: tk.line };
      case 'if': {
        next(); expect('('); const cond = parseExpr(); expect(')');
        const then = parseStmt(); const els = accept('else') ? parseStmt() : null;
        return { k: 'if', cond, then, els, line: tk.line };
      }
      case 'while': { next(); expect('('); const cond = parseExpr(); expect(')'); return { k: 'while', cond, body: parseStmt(), line: tk.line }; }
      case 'do': {
        next(); const body = parseStmt(); const w = expect('while', "'while' al final del do"); expect('(');
        const cond = parseExpr(); expect(')'); expect(';');
        return { k: 'do', body, cond, line: tk.line, condLine: w.line };
      }
      case 'for': {
        next(); expect('(');
        let init = null;
        if (isTypeStart() || at('const')) { const c = !!accept('const'); const ts = parseTypeSpec(); init = { k: 'decls', decls: parseDeclList(ts, c), line: tk.line }; }
        else if (!at(';')) init = parseExpr();
        expect(';');
        const cond = at(';') ? null : parseExpr(); expect(';');
        const step = at(')') ? null : parseExpr(); expect(')');
        return { k: 'for', init, cond, step, body: parseStmt(), line: tk.line };
      }
      case 'switch': {
        next(); expect('('); const e = parseExpr(); expect(')');
        const open = expect('{');
        const cases = []; let cur = null;
        while (!at('}')) {
          if (at('eof')) throw bErr('Falta cerrar con } el switch', open.line);
          if (at('case')) { const ct = next(); const v = parseCond(); expect(':', "':' después del case"); cur = { vals: [v], isDefault: false, body: [], line: ct.line }; cases.push(cur); continue; }
          if (at('default')) { const dt = next(); expect(':', "':' después de default"); if (cases.some(c => c.isDefault)) throw bErr('El switch ya tiene un default', dt.line); cur = { vals: [], isDefault: true, body: [], line: dt.line }; cases.push(cur); continue; }
          if (!cur) throw bErr('Dentro de un switch, antes de las instrucciones va case o default', toks[p].line);
          cur.body.push(parseStmt());
        }
        next();
        return { k: 'switch', e, cases, line: tk.line };
      }
      case 'return': { next(); const e = at(';') ? null : parseExpr(); expect(';'); return { k: 'return', e, line: tk.line }; }
      case 'break': next(); expect(';'); return { k: 'break', line: tk.line };
      case 'continue': next(); expect(';'); return { k: 'continue', line: tk.line };
      case 'cobegin': case 'parbegin': { next(); const body = parseBlock(); return { k: 'cobegin', body, line: tk.line }; }
      case 'cout': {
        next(); const items = [];
        while (accept('<<')) {
          if (accept('endl')) items.push({ endl: true });
          else items.push({ e: parseAdd() });
        }
        if (!items.length) throw bErr('Después de cout va << y lo que quieres mostrar', tk.line);
        expect(';');
        return { k: 'cout', items, line: tk.line };
      }
      case 'cin': case 'nbcin': {
        next(); prog.uses.input = true;
        const targets = [];
        while (accept('>>')) {
          const t = parseUnary();
          if (!isL(t)) throw bErr(`Después de ${tk.t} >> va una variable`, tk.line);
          targets.push(t);
        }
        if (!targets.length) throw bErr(`Después de ${tk.t} va >> y la variable donde guardar el dato`, tk.line);
        expect(';');
        return { k: 'cin', nb: tk.t === 'nbcin', targets, line: tk.line };
      }
      case 'endl': throw bErr('endl solo se usa dentro de cout: cout << ... << endl;', tk.line);
      case 'typedef': throw bErr('typedef solo se puede usar fuera de las funciones', tk.line);
      case 'monitor': throw bErr('Un monitor se declara fuera de las funciones', tk.line);
      case 'case': case 'default': throw bErr(`${tk.t} solo puede ir dentro de un switch`, tk.line);
      default: {
        const e = parseExpr(); expect(';');
        return { k: 'expr', e, line: tk.line };
      }
    }
  }
  function parseExpr() { return parseAssign(); }
  function parseAssign() {
    const left = parseCond();
    const t = toks[p].t;
    if (t === '=' && isL(left) && (peekT().t === ',' || peekT().t === ')')) { const op = next(); return { k: 'eqmark', target: left, line: op.line }; }
    if (t === '=' || t === '+=' || t === '-=' || t === '*=' || t === '/=' || t === '%=') {
      const op = next();
      if (!isL(left)) throw bErr('A la izquierda de = debe ir una variable', op.line);
      const value = parseAssign();
      return { k: 'assign', op: op.t, target: left, value, line: op.line };
    }
    return left;
  }
  function parseCond() {
    const c = parseOr();
    if (at('?')) { const q = next(); const a = parseAssign(); expect(':', "':' del operador ?:"); const b = parseCond(); return { k: 'tern', c, a, b, line: q.line }; }
    return c;
  }
  function binary(sub, ops) {
    return function () {
      let a = sub();
      while (ops.includes(toks[p].t)) { const op = next(); const b = sub(); a = { k: 'bin', op: op.t, a, b, line: op.line }; }
      return a;
    };
  }
  function parseUnary() {
    const tk = toks[p];
    if (tk.t === '!' || tk.t === '-' || tk.t === '+') { next(); return { k: 'un', op: tk.t, e: parseUnary(), line: tk.line }; }
    if (tk.t === '++' || tk.t === '--') {
      next(); const t = parseUnary();
      if (!isL(t)) throw bErr(`${tk.t} necesita una variable`, tk.line);
      return { k: 'pre', op: tk.t, target: t, line: tk.line };
    }
    if (tk.t === '&') throw bErr('En C-- no se usa & para pasar variables: el parámetro de la función ya dice si es por referencia', tk.line);
    return parsePostfix();
  }
  function parsePostfix() {
    let e = parsePrimary();
    for (;;) {
      const tk = toks[p];
      if (tk.t === '[') {
        if (e.k !== 'var' && e.k !== 'idx') throw bErr('Solo se puede usar [ ] sobre el nombre de un arreglo o string', tk.line);
        next(); const index = parseExpr(); expect(']');
        e = e.k === 'var' ? { k: 'idx', name: e.name, idx: [index], line: tk.line } : { k: 'idx', name: e.name, idx: e.idx.concat(index), line: e.line };
      } else if (tk.t === '++' || tk.t === '--') {
        if (!isL(e)) throw bErr(`${tk.t} necesita una variable`, tk.line);
        next(); e = { k: 'post', op: tk.t, target: e, line: tk.line };
      } else break;
    }
    return e;
  }
  function parsePrimary() {
    const tk = next();
    switch (tk.t) {
      case 'num': return { k: 'num', v: tk.v, line: tk.line, isChar: !!tk.isChar };
      case 'true': return { k: 'num', v: 1, line: tk.line };
      case 'false': return { k: 'num', v: 0, line: tk.line };
      case 'str': return { k: 'str', v: tk.v, line: tk.line };
      case 'int': case 'char':
        if (at('(')) { next(); const e = parseExpr(); expect(')'); return { k: 'cast', to: tk.t, e, line: tk.line }; }
        break;
      case 'id':
        if (at('(')) {
          next(); const args = [];
          if (!at(')')) { do { args.push(parseAssign()); } while (accept(',')); }
          expect(')');
          if (LINDA.has(tk.v)) prog.uses.linda = true;
          if (GFX.has(tk.v)) prog.uses.gfx = true;
          return { k: 'call', name: tk.v, args, line: tk.line };
        }
        return { k: 'var', name: tk.v, line: tk.line };
      case '(': { const e = parseExpr(); expect(')'); return e; }
    }
    p--;
    throw bErr(`No se esperaba ${desc(tk)} aquí`, tk.line);
  }
  const parseMul = binary(parseUnary, ['*','/','%']);
  const parseAdd = binary(parseMul, ['+','-']);
  const parseRel = binary(parseAdd, ['<','<=','>','>=']);
  const parseEq = binary(parseRel, ['==','!=']);
  const parseAnd = binary(parseEq, ['&&']);
  const parseOr = binary(parseAnd, ['||']);

  while (!at('eof')) {
    if (at('monitor')) { parseMonitor(); continue; }
    if (at('extern')) { skipExtern(); continue; }
    if (at(';')) { next(); continue; }
    parseTopItem(prog.globals, null);
  }
  if (!prog.funcs.has('main')) throw bErr('Falta la función main()', toks[toks.length - 1].line);
  return prog;
}

/* ------------------------------------------------------- revisión previa */
const BUILTINS = {
  wait: [1,1], signal: [1,1], p: [1,1], v: [1,1], P: [1,1], V: [1,1], initialsem: [2,2], random: [1,1],
  waitc: [1,2], signalc: [1,1], empty: [1,1], suspend: [0,0], revive: [1,1], which_proc: [0,0],
  stringCopy: [2,2], stringConcat: [2,2], stringCompare: [2,2], stringLength: [1,1], sprintf: [2,64], sscanf: [2,64],
  postnote: [1,3], readnote: [1,3], removenote: [1,3], readnoteeq: [1,3], removenoteeq: [1,3],
  create: [7,7], changecolor: [2,2], makevisible: [2,2], moveto: [3,3], moveby: [3,3],
};
const MON_ONLY = new Set(['waitc','signalc','empty']);
function check(prog) {
  let ctx = null;
  const visit = (n, eqOk) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(x => visit(x, false)); return; }
    if (n.k === 'eqmark' && !eqOk) throw bErr('La forma "variable=" solo se usa en readnote y removenote (Linda)', n.line);
    if (n.k === 'call') {
      const fn = prog.funcs.get(n.name);
      if (fn) {
        if (fn.params.length !== n.args.length) throw bErr(`${n.name}() recibe ${fn.params.length} argumento(s) y aquí se le pasan ${n.args.length}`, n.line);
        if (n.name === 'main') throw bErr('main() no se puede llamar desde el programa', n.line);
      } else if (n.name in BUILTINS) {
        const [mn, mx] = BUILTINS[n.name];
        if (n.args.length < mn || n.args.length > mx) throw bErr(`${n.name}() recibe ${mn === mx ? mn : mn + ' a ' + mx} argumento(s) y aquí se le pasan ${n.args.length}`, n.line);
        if (MON_ONLY.has(n.name) && !ctx) throw bErr(`${n.name}() solo se puede usar dentro de un procedimiento de un monitor`, n.line);
      } else if (prog.protos.has(n.name)) throw bErr(`La función '${n.name}' está declarada pero falta su definición (el cuerpo con { })`, n.line);
      else throw bErr(`La función '${n.name}' no existe`, n.line);
      const eqArgs = !fn && LINDA_READ.has(n.name);
      n.args.forEach((a, i) => visit(a, eqArgs && i > 0));
      return;
    }
    if (n.k === 'monitor') { const prev = ctx; ctx = n.name; visit(n.decls); visit(n.init); ctx = prev; return; }
    for (const k in n) if (k !== 'line') visit(n[k], false);
  };
  for (const f of prog.funcs.values()) { ctx = f.monitor || null; visit(f.body); }
  ctx = null;
  visit(prog.globals);
  const main = prog.funcs.get('main');
  if (main.params.length) throw bErr('main() no debe recibir parámetros', main.line);
}

function compile(src, resolve, mainName) {
  const { toks, files } = lexProgram(src, resolve, mainName);
  const prog = parse(toks, files);
  check(prog);
  return prog;
}

/* --------------------------------------------------- formato estilo printf */
function cfmt(fmt, args, line) {
  let ai = 0;
  return fmt.replace(/%([-0+ #]*)(\d+)?(?:\.(\d+))?([dioxXcsq%])/g, (m, flags, w, prec, conv) => {
    if (conv === '%') return '%';
    if (ai >= args.length) throw bErr('sprintf: faltan valores para el formato', line);
    const v = args[ai++];
    let s;
    if ('dioxXc'.includes(conv) && typeof v === 'string') throw bErr(`sprintf: %${conv} espera un número y recibió un string`, line);
    switch (conv) {
      case 'd': case 'i': s = String(Math.abs(v)); if (prec) s = s.padStart(+prec, '0'); s = (v < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s; break;
      case 'o': s = (v >>> 0).toString(8); if (flags.includes('#')) s = '0' + s; break;
      case 'x': s = (v >>> 0).toString(16); if (flags.includes('#')) s = '0x' + s; break;
      case 'X': s = (v >>> 0).toString(16).toUpperCase(); if (flags.includes('#')) s = '0X' + s; break;
      case 'c': s = String.fromCharCode(v); break;
      case 's': s = String(v); if (prec) s = s.slice(0, +prec); break;
      case 'q': s = '"' + String(v) + '"'; break;
    }
    if (w && s.length < +w) {
      if (flags.includes('-')) s = s.padEnd(+w);
      else if (flags.includes('0') && 'dioxX'.includes(conv)) {
        const sign = /^[-+ ]/.test(s) ? s[0] : '';
        s = sign + s.slice(sign.length).padStart(+w - sign.length, '0');
      } else s = s.padStart(+w);
    }
    return s;
  });
}

/* --------------------------------------------------------------- máquina */
class Machine {
  constructor(prog, rnd) {
    this.prog = prog; this.rnd = rnd || Math.random;
    this.globals = new Map(); this.globalScope = { vars: this.globals, parent: null };
    this.procs = []; this.sems = []; this.out = []; this.outBase = 0;
    this.monitors = new Map(); this.seq = 0;
    this.board = []; this.noteSeq = 0;
    this.gfx = new Map(); this.gfxVer = 0;
    this.inBuf = ''; this.waitingInput = null;
    this.steps = 0; this.status = 'ready'; this.error = null; this.cur = null; this.quantum = 0; this.main = null;
    this.warned = new Set();
  }
  fmtLine(l) {
    if (l == null) return '';
    const f = Math.floor(l / LF), n = l % LF;
    return f === 0 ? `línea ${n}` : `línea ${n} de ${this.prog.files[f]}`;
  }
  boot() {
    const dummy = { pid: 0, name: '(global)', depth: 0, atomic: 0, mon: null, state: 'ready' };
    for (const d of this.prog.globals) {
      if (d.k === 'monitor') {
        const mon = { name: d.name, owner: null, entry: [], urgent: [], conds: [], scope: { vars: new Map(), parent: null }, init: d.init };
        this.monitors.set(d.name, mon);
        const md = { pid: 0, name: `(monitor ${d.name})`, depth: 0, atomic: 0, mon, state: 'ready' };
        for (const x of d.decls) this.runSync(this.declare(x, mon.scope, md, mon));
      } else this.runSync(this.declare(d, this.globalScope, dummy, null));
    }
    for (const mon of this.monitors.values()) {
      if (!mon.init) continue;
      const md = { pid: 0, name: `init de ${mon.name}`, depth: 0, atomic: 0, mon, state: 'ready', color: 0 };
      const g = this.execBlock(mon.init, md, mon.scope);
      let r; do { r = g.next(); if (!r.done && md.state !== 'ready') throw bErr(`El init del monitor '${mon.name}' no puede quedarse esperando`, mon.init.line); } while (!r.done);
    }
    const main = this.newProc('main', null);
    main.gen = this.callFunc(this.prog.funcs.get('main'), [], main);
    this.main = main;
  }
  runSync(g) { let r; do { r = g.next(); } while (!r.done); return r.value; }
  newProc(name, parent) {
    const pid = this.procs.length;
    const p = { pid, name, parent, state: 'ready', line: null, gen: null, blockedOn: null, blockKind: null, children: 0, spawning: false, depth: 0, atomic: 0, mon: null, color: pid === 0 ? 0 : ((pid - 1) % 8) + 1 };
    this.procs.push(p);
    return p;
  }
  write(proc, text, cls) {
    const segs = this.out, last = segs[segs.length - 1];
    if (last && last.pid === proc.pid && !cls && !last.cls) last.text += text;
    else segs.push({ pid: proc.pid, color: proc.color || 0, text, cls });
    if (segs.length > 3000) { segs.splice(0, 1000); this.outBase++; }
  }
  note(text, cls) { this.out.push({ pid: -9, color: 0, text, cls }); }
  warnOnce(key, text) { if (this.warned.has(key)) return; this.warned.add(key); this.note(text, 'warn'); }
  lookup(name, scope, line) {
    for (let s = scope; s; s = s.parent) { const c = s.vars.get(name); if (c) return c; }
    const g = this.globals.get(name); if (g) return g;
    throw bErr(`La variable '${name}' no está declarada`, line);
  }
  arith(op, a, b, line) {
    if (typeof a === 'string' || typeof b === 'string') {
      if (op === '==' || op === '!=' || op === '<' || op === '>' || op === '<=' || op === '>=') throw bErr('Los strings no se comparan con operadores; usa stringCompare(a, b)', line);
      throw bErr('No se puede hacer aritmética con un string', line);
    }
    switch (op) {
      case '+': return (a + b) | 0;
      case '-': return (a - b) | 0;
      case '*': return Math.imul(a, b);
      case '/': if (b === 0) throw bErr('División por cero', line); return Math.trunc(a / b) | 0;
      case '%': if (b === 0) throw bErr('División por cero (operador %)', line); return (a % b) | 0;
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
    }
    throw bErr(`Operador desconocido ${op}`, line);
  }
  /* ---- variables ---- */
  makeCell(base, strLen, dims, name, mon, line) {
    if (dims.length) {
      const items = [];
      for (let i = 0; i < dims[0]; i++) items.push(this.makeCell(base, strLen, dims.slice(1), `${name}[${i}]`, mon, line));
      return { kind: 'arr', type: base, items, name };
    }
    switch (base) {
      case 'semaphore': case 'binarysem': {
        const sem = { name, binary: base === 'binarysem', value: 0, init: 0, queue: [] };
        this.sems.push(sem);
        return { kind: 'sem', sem };
      }
      case 'condition': {
        if (!mon) throw bErr('Una condition solo puede declararse en la parte de variables de un monitor', line);
        const cond = { name, mon, queue: [] };
        mon.conds.push(cond);
        return { kind: 'cond', cond };
      }
      case 'string': return { kind: 'str', max: strLen, s: '' };
      default: return { kind: 'int', type: base === 'char' ? 'char' : 'int', v: 0 };
    }
  }
  *declare(d, scope, proc, mon) {
    if (scope.vars.has(d.name)) throw bErr(`'${d.name}' ya fue declarada antes`, d.line);
    const dims = [];
    let total = 1;
    for (const de of d.dims) {
      const n = yield* this.evNum(de, proc, scope);
      if (n <= 0) throw bErr(`El tamaño del arreglo '${d.name}' debe ser mayor que 0`, d.line);
      dims.push(n); total *= n;
    }
    if (total > 200000) throw bErr(`El arreglo '${d.name}' es demasiado grande`, d.line);
    let strLen = null;
    if (d.base === 'string') {
      strLen = yield* this.evNum(d.strLen, proc, scope);
      if (strLen <= 0) throw bErr('El largo de un string debe ser mayor que 0', d.line);
    }
    const cell = this.makeCell(d.base, strLen, dims, d.name, mon, d.line);
    if (cell.kind === 'sem') cell.sem.local = proc.pid > 0 || !!proc.parent;
    if (d.init) {
      if (cell.kind === 'sem') {
        const v = yield* this.evNum(d.init, proc, scope);
        if (cell.sem.binary && v !== 0 && v !== 1) throw bErr(`Un binarysem solo puede valer 0 o 1 (aquí empieza en ${v})`, d.line);
        if (v < 0) throw bErr('Un semáforo no puede empezar con un valor negativo', d.line);
        cell.sem.value = v; cell.sem.init = v;
      } else if (cell.kind === 'str') {
        const v = yield* this.ev(d.init, proc, scope);
        if (typeof v !== 'string') throw bErr(`A un string se le asigna un texto entre comillas`, d.line);
        this.setStr(cell, v, d.line);
      } else cell.v = yield* this.evNum(d.init, proc, scope);
    }
    if (d.isConst) cell.isConst = true;
    scope.vars.set(d.name, cell);
  }
  label(e) { return e.k === 'var' ? e.name : e.name + '[…]'; }
  *getCell(e, proc, scope) {
    if (e.k === 'var') return this.lookup(e.name, scope, e.line);
    if (e.k !== 'idx') throw bErr('Aquí se esperaba una variable', e.line);
    let c = this.lookup(e.name, scope, e.line), label = e.name;
    for (const ie of e.idx) {
      const i = yield* this.evNum(ie, proc, scope);
      if (c.kind === 'arr') {
        if (i < 0 || i >= c.items.length) throw bErr(`Índice fuera del arreglo: ${label}[${i}] (tiene ${c.items.length} posiciones, de 0 a ${c.items.length - 1})`, e.line);
        c = c.items[i]; label += `[${i}]`;
      } else if (c.kind === 'str') {
        const sc = c;
        if (i < 0 || i >= sc.max) throw bErr(`Índice fuera del string: ${label}[${i}] (largo máximo ${sc.max})`, e.line);
        c = { kind: 'int', type: 'char',
          get v() { return i < sc.s.length ? sc.s.charCodeAt(i) : 0; },
          set v(x) { let s = sc.s; while (s.length < i) s += ' '; sc.s = x === 0 ? s.slice(0, i) : s.slice(0, i) + String.fromCharCode(x) + s.slice(i + 1); } };
        label += `[${i}]`;
      } else throw bErr(`'${label}' no es un arreglo: no se puede usar [ ]`, e.line);
    }
    return c;
  }
  *lref(e, proc, scope) {
    const c = yield* this.getCell(e, proc, scope);
    const nm = this.label(e);
    if (c.kind === 'sem') throw bErr(`'${nm}' es un semáforo: no se le asigna un valor con =. Usa wait/signal o initialsem(${nm}, valor)`, e.line);
    if (c.kind === 'cond') throw bErr(`'${nm}' es una condition: no se le asigna un valor. Usa waitc y signalc`, e.line);
    if (c.kind === 'arr') throw bErr(`'${nm}' es un arreglo: no se puede asignar completo, asigna cada posición`, e.line);
    if (c.kind === 'str') throw bErr(`'${nm}' es un string: para darle un valor usa stringCopy(${nm}, "texto")`, e.line);
    if (c.isConst) throw bErr(`'${nm}' es constante y no se puede cambiar`, e.line);
    return c;
  }
  setStr(c, s, line) {
    if (c.isConst) throw bErr('Ese string es constante', line);
    if (s.length > c.max) { this.warnOnce('str' + line, `[aviso] ${this.fmtLine(line)}: el texto no cabe en un string[${c.max}] y se cortó.\n`); s = s.slice(0, c.max); }
    c.s = s;
  }
  isCharExpr(e, scope) {
    switch (e.k) {
      case 'num': return !!e.isChar;
      case 'cast': return e.to === 'char';
      case 'var': case 'idx': {
        let c; try { c = this.lookup(e.name, scope, e.line); } catch (x) { return false; }
        if (e.k === 'idx') for (let j = 0; j < e.idx.length; j++) { if (c.kind === 'arr') c = c.items[0]; else return c.kind === 'str'; }
        return !!c && c.type === 'char';
      }
      case 'call': { const f = this.prog.funcs.get(e.name); return !!f && f.type === 'char'; }
      case 'tern': return this.isCharExpr(e.a, scope) && this.isCharExpr(e.b, scope);
    }
    return false;
  }
  /* ---- expresiones ---- */
  *evNum(e, proc, scope) {
    const v = yield* this.ev(e, proc, scope);
    if (typeof v === 'string') throw bErr('Aquí se esperaba un número y hay un string', e.line);
    return v;
  }
  *ev(e, proc, scope) {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'var': case 'idx': {
        const c = yield* this.getCell(e, proc, scope);
        const nm = this.label(e);
        if (c.kind === 'sem') throw bErr(`'${nm}' es un semáforo: no se puede leer ni comparar como un número. Usa wait(${nm}) y signal(${nm})`, e.line);
        if (c.kind === 'cond') throw bErr(`'${nm}' es una condition: no tiene valor. Para saber si hay alguien esperando usa empty(${nm})`, e.line);
        if (c.kind === 'arr') throw bErr(`'${nm}' es un arreglo: falta el índice, por ejemplo ${e.name}[0]`, e.line);
        if (c.kind === 'str') return c.s;
        return c.v;
      }
      case 'cast': { const v = yield* this.evNum(e.e, proc, scope); return e.to === 'char' ? (v & 0xFF) : v; }
      case 'tern': { const c = yield* this.evNum(e.c, proc, scope); return c ? yield* this.ev(e.a, proc, scope) : yield* this.ev(e.b, proc, scope); }
      case 'un': {
        const v = yield* this.evNum(e.e, proc, scope);
        return e.op === '-' ? (-v | 0) : e.op === '!' ? (v ? 0 : 1) : v;
      }
      case 'bin': {
        if (e.op === '&&') { const a = yield* this.evNum(e.a, proc, scope); if (!a) return 0; const b = yield* this.evNum(e.b, proc, scope); return b ? 1 : 0; }
        if (e.op === '||') { const a = yield* this.evNum(e.a, proc, scope); if (a) return 1; const b = yield* this.evNum(e.b, proc, scope); return b ? 1 : 0; }
        const a = yield* this.ev(e.a, proc, scope);
        const b = yield* this.ev(e.b, proc, scope);
        return this.arith(e.op, a, b, e.line);
      }
      case 'assign': {
        const c = yield* this.lref(e.target, proc, scope);
        let v = yield* this.evNum(e.value, proc, scope);
        if (e.op !== '=') v = this.arith(e.op[0], c.v, v, e.line);
        yield { line: e.line };          // aquí puede cambiar de proceso: entre leer y guardar
        c.v = v;
        return v;
      }
      case 'pre': {
        const c = yield* this.lref(e.target, proc, scope);
        const v = (c.v + (e.op === '++' ? 1 : -1)) | 0;
        yield { line: e.line };
        c.v = v; return v;
      }
      case 'post': {
        const c = yield* this.lref(e.target, proc, scope);
        const old = c.v;
        yield { line: e.line };
        c.v = (old + (e.op === '++' ? 1 : -1)) | 0; return old;
      }
      case 'call': return yield* this.call(e, proc, scope);
      case 'eqmark': throw bErr('La forma "variable=" solo se usa en readnote y removenote', e.line);
    }
    throw bErr('Expresión no soportada', e.line);
  }
  *argCells(fn, e, proc, scope) {
    const cells = [];
    for (let i = 0; i < fn.params.length; i++) {
      const pa = fn.params[i], a = e.args[i], n = i + 1;
      if (pa.base === 'semaphore' || pa.base === 'binarysem' || pa.base === 'condition') {
        if (a.k !== 'var' && a.k !== 'idx') throw bErr(`El parámetro ${n} de ${fn.name}() espera un ${pa.base}`, e.line);
        const c = yield* this.getCell(a, proc, scope);
        if (c.kind !== (pa.base === 'condition' ? 'cond' : 'sem')) throw bErr(`El parámetro ${n} de ${fn.name}() espera un ${pa.base}`, e.line);
        cells.push(c);
      } else if (pa.isArr) {
        if (a.k !== 'var' && a.k !== 'idx') throw bErr(`El parámetro ${n} de ${fn.name}() espera un arreglo`, e.line);
        const c = yield* this.getCell(a, proc, scope);
        if (c.kind !== 'arr') throw bErr(`El parámetro ${n} de ${fn.name}() espera un arreglo`, e.line);
        cells.push(c);
      } else if (pa.base === 'string') {
        if (a.k === 'str') { cells.push({ kind: 'str', max: Math.max(a.v.length, 1), s: a.v, isConst: true }); continue; }
        if (a.k !== 'var' && a.k !== 'idx') throw bErr(`El parámetro ${n} de ${fn.name}() espera un string`, e.line);
        const c = yield* this.getCell(a, proc, scope);
        if (c.kind !== 'str') throw bErr(`El parámetro ${n} de ${fn.name}() espera un string`, e.line);
        cells.push(c);
      } else if (pa.ref) {
        if (a.k !== 'var' && a.k !== 'idx') throw bErr(`El parámetro ${n} de ${fn.name}() es por referencia (&): pásale una variable`, e.line);
        cells.push(yield* this.lref(a, proc, scope));
      } else {
        const v = yield* this.evNum(a, proc, scope);
        cells.push({ kind: 'int', type: pa.base === 'char' ? 'char' : 'int', v });
      }
    }
    return cells;
  }
  *call(e, proc, scope) {
    const fn = this.prog.funcs.get(e.name);
    if (fn) {
      const cells = yield* this.argCells(fn, e, proc, scope);
      return yield* this.callFunc(fn, cells, proc);
    }
    return yield* this.builtin(e, proc, scope);
  }
  *callFunc(fn, cells, proc) {
    const mon = fn.monitor ? this.monitors.get(fn.monitor) : null;
    const scope = { vars: new Map(), parent: mon ? mon.scope : null };
    fn.params.forEach((pa, i) => scope.vars.set(pa.name, cells[i]));
    proc.depth++;
    if (proc.depth > 300) throw bErr(`Demasiadas llamadas anidadas a ${fn.name}() (¿recursión infinita?)`, fn.line);
    const outer = proc.mon;
    const enters = mon && outer !== mon;
    if (enters) { yield* this.monEnter(mon, proc, fn.line); proc.mon = mon; }
    if (fn.atomic) proc.atomic++;
    const r = yield* this.execBlock(fn.body, proc, scope);
    if (fn.atomic) proc.atomic--;
    if (enters) { proc.mon = outer; this.monRelease(mon); }
    proc.depth--;
    if (r && (r.brk || r.cont)) throw bErr('break o continue fuera de un ciclo', fn.line);
    if (r && r.ret && fn.type === 'void' && r.hasValue) throw bErr(`${fn.name}() es void y no puede devolver un valor`, fn.line);
    return r && r.ret ? r.value : 0;
  }
  /* ---- funciones de la biblioteca ---- */
  *semArg(a, fname, proc, scope, line) {
    if (!a || (a.k !== 'var' && a.k !== 'idx')) throw bErr(`${fname}() necesita el nombre de un semáforo`, line);
    const c = yield* this.getCell(a, proc, scope);
    if (c.kind !== 'sem') throw bErr(`'${this.label(a)}' no es un semáforo: decláralo como semaphore o binarysem`, line);
    return c.sem;
  }
  *condArg(a, fname, proc, scope, line) {
    if (!a || (a.k !== 'var' && a.k !== 'idx')) throw bErr(`${fname}() necesita el nombre de una condition`, line);
    const c = yield* this.getCell(a, proc, scope);
    if (c.kind !== 'cond') throw bErr(`'${this.label(a)}' no es una condition del monitor`, line);
    if (proc.mon !== c.cond.mon) throw bErr(`${fname}(${this.label(a)}) solo se puede usar dentro de un procedimiento del monitor '${c.cond.mon.name}'`, line);
    return c.cond;
  }
  *strArg(a, fname, proc, scope, line) {
    if (a.k === 'str') return a.v;
    const v = yield* this.ev(a, proc, scope);
    if (typeof v !== 'string') throw bErr(`${fname}() espera un string en esa posición`, line);
    return v;
  }
  *strDest(a, fname, proc, scope, line) {
    if (a.k !== 'var' && a.k !== 'idx') throw bErr(`El primer argumento de ${fname}() debe ser una variable string`, line);
    const c = yield* this.getCell(a, proc, scope);
    if (c.kind !== 'str') throw bErr(`El primer argumento de ${fname}() debe ser una variable string (declárala como string[20] nombre;)`, line);
    return c;
  }
  *builtin(e, proc, scope) {
    const A = e.args, L = e.line, name = e.name;
    switch (name) {
      case 'wait': case 'p': case 'P': { const s = yield* this.semArg(A[0], name, proc, scope, L); yield* this.semWait(s, proc, L); return 0; }
      case 'signal': case 'v': case 'V': { const s = yield* this.semArg(A[0], name, proc, scope, L); this.semSignal(s, proc, L); return 0; }
      case 'initialsem': {
        const s = yield* this.semArg(A[0], name, proc, scope, L);
        const v = yield* this.evNum(A[1], proc, scope);
        if (v < 0 || (s.binary && v > 1)) throw bErr(`Valor inválido para el semáforo '${s.name}': ${v}`, L);
        s.value = v; s.init = v; return 0;
      }
      case 'random': {
        const n = yield* this.evNum(A[0], proc, scope);
        if (n <= 0) throw bErr('random(n) necesita un n mayor que 0', L);
        return Math.floor(Math.random() * n);
      }
      case 'waitc': {
        const c = yield* this.condArg(A[0], name, proc, scope, L);
        let prio = 10;
        if (A.length > 1) prio = yield* this.evNum(A[1], proc, scope);
        yield* this.condWait(c, prio, proc, L);
        return 0;
      }
      case 'signalc': { const c = yield* this.condArg(A[0], name, proc, scope, L); yield* this.condSignal(c, proc, L); return 0; }
      case 'empty': { const c = yield* this.condArg(A[0], name, proc, scope, L); return c.queue.length ? 0 : 1; }
      case 'which_proc': return proc.pid;
      case 'suspend': {
        proc.state = 'blocked'; proc.blockKind = 'suspend'; proc.blockedOn = { name: 'suspend' };
        yield { line: L };
        return 0;
      }
      case 'revive': {
        const n = yield* this.evNum(A[0], proc, scope);
        const q = this.procs[n];
        if (!q) throw bErr(`revive(${n}): no existe el proceso número ${n}`, L);
        if (q.blockKind === 'suspend') this.wake(q);
        return 0;
      }
      case 'stringCopy': { const d = yield* this.strDest(A[0], name, proc, scope, L); const s = yield* this.strArg(A[1], name, proc, scope, L); this.setStr(d, s, L); return 0; }
      case 'stringConcat': { const d = yield* this.strDest(A[0], name, proc, scope, L); const s = yield* this.strArg(A[1], name, proc, scope, L); this.setStr(d, d.s + s, L); return 0; }
      case 'stringCompare': {
        const a = yield* this.strArg(A[0], name, proc, scope, L), b = yield* this.strArg(A[1], name, proc, scope, L);
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
        return a.length === b.length ? 0 : a.length < b.length ? -b.charCodeAt(a.length) : a.charCodeAt(b.length);
      }
      case 'stringLength': { const s = yield* this.strArg(A[0], name, proc, scope, L); return s.length; }
      case 'sprintf': {
        const d = yield* this.strDest(A[0], name, proc, scope, L);
        const fmt = yield* this.strArg(A[1], name, proc, scope, L);
        const vals = [];
        for (let i = 2; i < A.length; i++) vals.push(yield* this.ev(A[i], proc, scope));
        this.setStr(d, cfmt(fmt, vals, L), L);
        return 0;
      }
      case 'sscanf': {
        const src = yield* this.strArg(A[0], name, proc, scope, L);
        const fmt = yield* this.strArg(A[1], name, proc, scope, L);
        const cells = [];
        for (let i = 2; i < A.length; i++) {
          if (A[i].k !== 'var' && A[i].k !== 'idx') throw bErr('sscanf() necesita variables donde guardar lo leído', L);
          cells.push(yield* this.getCell(A[i], proc, scope));
        }
        return this.scan(src, fmt, cells, L);
      }
      case 'postnote': {
        const c = yield* this.evNum(A[0], proc, scope);
        const a = A.length > 1 ? yield* this.evNum(A[1], proc, scope) : FLAG_INT;
        const b = A.length > 2 ? yield* this.evNum(A[2], proc, scope) : FLAG_INT;
        this.board.push({ c, a, b, id: this.noteSeq++ });
        for (const q of this.procs) if (q.blockKind === 'linda') this.wake(q);   // todos reintentan
        yield { line: L };
        return 0;
      }
      case 'readnote': case 'removenote': case 'readnoteeq': case 'removenoteeq':
        yield* this.lindaTake(e, proc, scope, name.startsWith('remove'), name.endsWith('eq'));
        return 0;
      case 'create': {
        const v = []; for (const a of A) v.push(yield* this.evNum(a, proc, scope));
        this.gfx.set(v[0], { fig: v[1], color: v[2], x: v[3], y: v[4], s1: v[5], s2: v[6], visible: true });
        this.gfxVer++; return 0;
      }
      case 'changecolor': case 'makevisible': case 'moveto': case 'moveby': {
        const v = []; for (const a of A) v.push(yield* this.evNum(a, proc, scope));
        const f = this.gfx.get(v[0]);
        if (!f) throw bErr(`${name}(${v[0]}, ...): no existe la figura ${v[0]}; créala antes con create`, L);
        if (name === 'changecolor') f.color = v[1];
        else if (name === 'makevisible') f.visible = !!v[1];
        else if (name === 'moveto') { if (f.fig === 2) { f.s1 += v[1] - f.x; f.s2 += v[2] - f.y; } f.x = v[1]; f.y = v[2]; }
        else { f.x += v[1]; f.y += v[2]; if (f.fig === 2) { f.s1 += v[1]; f.s2 += v[2]; } }
        this.gfxVer++; return 0;
      }
    }
    throw bErr(`La función '${name}' no existe`, L);
  }
  scan(src, fmt, cells, line) {
    let si = 0, count = 0, ti = 0;
    const ws = c => /\s/.test(c);
    const need = (cell, kind) => {
      if (kind === 'str' && cell.kind !== 'str') throw bErr('sscanf: %s y %q necesitan una variable string', line);
      if (kind === 'num' && cell.kind !== 'int') throw bErr('sscanf: %d y %x necesitan una variable int', line);
      if (cell.isConst) throw bErr('sscanf no puede guardar en una constante', line);
    };
    for (let fi = 0; fi < fmt.length; fi++) {
      const f = fmt[fi];
      if (ws(f)) { while (si < src.length && ws(src[si])) si++; continue; }
      if (f !== '%') { if (src[si] !== f) return count; si++; continue; }
      const conv = fmt[++fi];
      if (conv === '%') { if (src[si] !== '%') return count; si++; continue; }
      if (!'dxsq'.includes(conv || '?')) throw bErr(`sscanf: el formato %${conv || ''} no está soportado (usa %d, %x, %s o %q)`, line);
      if (ti >= cells.length) throw bErr('sscanf: faltan variables para el formato', line);
      const cell = cells[ti++];
      while (si < src.length && ws(src[si])) si++;
      if (si >= src.length) return count;
      const rest = src.slice(si);
      if (conv === 'd') { const m = /^[-+]?\d+/.exec(rest); if (!m) return count; need(cell, 'num'); cell.v = parseInt(m[0], 10) | 0; si += m[0].length; }
      else if (conv === 'x') { const m = /^(0[xX])?[0-9a-fA-F]+/.exec(rest); if (!m) return count; need(cell, 'num'); cell.v = parseInt(m[0].replace(/^0[xX]/, ''), 16) | 0; si += m[0].length; }
      else if (conv === 's') { let j = si; while (j < src.length && !ws(src[j])) j++; need(cell, 'str'); this.setStr(cell, src.slice(si, j), line); si = j; }
      else { if (src[si] !== '"') return count; const j = src.indexOf('"', si + 1); if (j < 0) return count; need(cell, 'str'); this.setStr(cell, src.slice(si + 1, j), line); si = j + 1; }
      count++;
    }
    return count;
  }
  *lindaTake(e, proc, scope, remove, eqAll) {
    const A = e.args;
    const c = yield* this.evNum(A[0], proc, scope);
    const slots = [];
    for (let i = 1; i < 3; i++) {
      const a = A[i];
      if (!a) { slots.push(null); continue; }
      let eq = eqAll, target = a;
      if (a.k === 'eqmark') { eq = true; target = a.target; }
      if (target.k !== 'var' && target.k !== 'idx') throw bErr(`${e.name}(): después del carácter van variables int`, e.line);
      slots.push({ cell: yield* this.lref(target, proc, scope), eq });
    }
    for (;;) {
      const idx = this.board.findIndex(n => n.c === c && slots.every((s, i) => !s || !s.eq || (i === 0 ? n.a : n.b) === s.cell.v));
      if (idx >= 0) {
        const n = this.board[idx];
        if (remove) this.board.splice(idx, 1);
        slots.forEach((s, i) => { if (s) s.cell.v = i === 0 ? n.a : n.b; });
        yield { line: e.line };
        return;
      }
      const want = [String.fromCharCode(c)].concat(slots.map(s => (s ? (s.eq ? String(s.cell.v) : '?') : null)).filter(x => x !== null));
      proc.state = 'blocked'; proc.blockKind = 'linda'; proc.blockedOn = { name: `(${want.join(', ')})` };
      yield { line: e.line };
    }
  }
  /* ---- semáforos ---- */
  wake(q) { q.state = 'ready'; q.blockedOn = null; q.blockKind = null; }
  *semWait(s, proc, line) {
    if (s.value > 0) { s.value--; return; }
    s.queue.push(proc);
    proc.state = 'blocked'; proc.blockedOn = s; proc.blockKind = 'sem';
    yield { line };
  }
  semSignal(s, proc, line) {
    if (s.queue.length) {
      const i = Math.floor(this.rnd() * s.queue.length);   // BACI despierta a uno al azar
      this.wake(s.queue.splice(i, 1)[0]);
      return;
    }
    if (s.binary && s.value >= 1) { this.warnOnce('bs' + s.name + line, `[aviso] ${this.fmtLine(line)}: signal(${s.name}) con el binarysem ya en 1; se queda en 1.\n`); return; }
    s.value++;
  }
  /* ---- monitores (Hoare, como BACI) ---- */
  *monEnter(mon, proc, line) {
    if (!mon.owner) { mon.owner = proc; return; }
    mon.entry.push(proc);
    proc.state = 'blocked'; proc.blockedOn = mon; proc.blockKind = 'entry';
    yield { line };
  }
  monRelease(mon) {
    if (mon.urgent.length) { const q = mon.urgent.pop(); mon.owner = q; this.wake(q); return; }
    if (mon.entry.length) { const i = Math.floor(this.rnd() * mon.entry.length); const q = mon.entry.splice(i, 1)[0]; mon.owner = q; this.wake(q); return; }
    mon.owner = null;
  }
  *condWait(c, prio, proc, line) {
    c.queue.push({ proc, prio, seq: this.seq++ });
    proc.state = 'blocked'; proc.blockedOn = c; proc.blockKind = 'cond';
    this.monRelease(c.mon);
    yield { line };
  }
  *condSignal(c, proc, line) {
    if (!c.queue.length) return;
    const minP = Math.min(...c.queue.map(w => w.prio));
    const cands = c.queue.map((w, i) => i).filter(i => c.queue[i].prio === minP);
    const pick = cands[Math.floor(this.rnd() * cands.length)];   // al azar entre los de mayor prioridad
    const w = c.queue.splice(pick, 1)[0].proc;
    const mon = c.mon;
    mon.owner = w; this.wake(w);
    mon.urgent.push(proc);
    proc.state = 'blocked'; proc.blockedOn = mon; proc.blockKind = 'urgent';
    yield { line };
  }
  /* ---- entrada ---- */
  provideInput(text) {
    this.inBuf += text + '\n';
    this.out.push({ pid: -8, color: 0, text: text + '\n', cls: 'in' });
    if (this.status === 'input') {
      this.status = 'running';
      const q = this.waitingInput; this.waitingInput = null;
      if (q) { this.wake(q); this.cur = q; this.quantum = 1; }
    }
  }
  readInput(kind) {
    const b = this.inBuf; let i = 0;
    while (i < b.length && isWs(b[i])) i++;
    if (i >= b.length) return null;
    if (kind === 'char') { this.inBuf = b.slice(i + 1); return b.charCodeAt(i); }
    let j = i; while (j < b.length && !isWs(b[j])) j++;
    const word = b.slice(i, j);
    if (kind === 'str') { this.inBuf = b.slice(j); return word; }
    const m = /^[-+]?\d+/.exec(word);
    if (!m) { this.inBuf = b.slice(j); return { bad: word }; }
    this.inBuf = b.slice(i + m[0].length);
    return parseInt(m[0], 10) | 0;
  }
  /* ---- instrucciones ---- */
  *spawn(e, proc, scope) {
    const fn = this.prog.funcs.get(e.name);
    const cells = yield* this.argCells(fn, e, proc, scope);
    const shown = cells.map((c, i) => c.kind === 'sem' ? c.sem.name : c.kind === 'cond' ? c.cond.name : c.kind === 'arr' || c.kind === 'str' ? this.label(e.args[i]) : (fn.params[i].base === 'char' ? `'${String.fromCharCode(c.v)}'` : String(c.v))).join(', ');
    const child = this.newProc(`${fn.name}(${shown})`, proc);
    child.gen = this.callFunc(fn, cells, child);
    proc.children++;
  }
  *execBlock(b, proc, scope) {
    const inner = { vars: new Map(), parent: scope };
    for (const s of b.body) {
      const r = yield* this.ex(s, proc, inner);
      if (r) return r;
    }
  }
  *ex(s, proc, scope) {
    switch (s.k) {
      case 'block': return yield* this.execBlock(s, proc, scope);
      case 'empty': return;
      case 'decls':
        yield { line: s.line };
        for (const d of s.decls) yield* this.declare(d, scope, proc, null);
        return;
      case 'expr':
        yield { line: s.line };
        if (proc.spawning && s.e.k === 'call' && this.prog.funcs.has(s.e.name)) { yield* this.spawn(s.e, proc, scope); return; }
        yield* this.ev(s.e, proc, scope);
        return;
      case 'cout': {
        yield { line: s.line };
        let first = true;
        for (const it of s.items) {
          if (!first) yield { line: s.line };   // jBACI puede cambiar de proceso a mitad de un cout
          first = false;
          if (it.endl) { this.write(proc, '\n'); continue; }
          const v = yield* this.ev(it.e, proc, scope);
          if (typeof v === 'string') this.write(proc, v);
          else this.write(proc, this.isCharExpr(it.e, scope) ? String.fromCharCode(v) : String(v));
        }
        return;
      }
      case 'cin': {
        yield { line: s.line };
        for (const t of s.targets) {
          const c = yield* this.getCell(t, proc, scope);
          const kind = c.kind === 'str' ? 'str' : c.kind === 'int' ? (c.type === 'char' ? 'char' : 'int') : null;
          if (!kind) throw bErr(`cin no puede leer en '${this.label(t)}'`, s.line);
          if (c.isConst) throw bErr(`'${this.label(t)}' es constante`, s.line);
          for (;;) {
            const r = this.readInput(kind);
            if (r !== null) {
              if (typeof r === 'object') throw bErr(`${s.nb ? 'nbcin' : 'cin'} esperaba un número entero y recibió "${r.bad}"`, s.line);
              if (kind === 'str') this.setStr(c, r, s.line); else c.v = r;
              break;
            }
            if (s.nb) { if (kind === 'str') c.s = ''; else c.v = kind === 'char' ? FLAG_CHAR : FLAG_INT; break; }
            proc.state = 'blocked'; proc.blockKind = 'input'; proc.blockedOn = { name: 'cin' };
            this.status = 'input'; this.waitingInput = proc;
            yield { line: s.line };
          }
        }
        return;
      }
      case 'if': {
        yield { line: s.line };
        const c = yield* this.evNum(s.cond, proc, scope);
        if (c) return yield* this.ex(s.then, proc, scope);
        if (s.els) return yield* this.ex(s.els, proc, scope);
        return;
      }
      case 'while':
        for (;;) {
          yield { line: s.line };
          const c = yield* this.evNum(s.cond, proc, scope);
          if (!c) break;
          const r = yield* this.ex(s.body, proc, scope);
          if (r) { if (r.brk) break; if (r.cont) continue; return r; }
        }
        return;
      case 'do':
        for (;;) {
          const r = yield* this.ex(s.body, proc, scope);
          if (r) { if (r.brk) break; if (!r.cont) return r; }
          yield { line: s.condLine };
          const c = yield* this.evNum(s.cond, proc, scope);
          if (!c) break;
        }
        return;
      case 'for': {
        const fs = { vars: new Map(), parent: scope };
        yield { line: s.line };
        if (s.init) {
          if (s.init.k === 'decls') { for (const d of s.init.decls) yield* this.declare(d, fs, proc, null); }
          else yield* this.ev(s.init, proc, fs);
        }
        for (;;) {
          yield { line: s.line };
          if (s.cond) { const c = yield* this.evNum(s.cond, proc, fs); if (!c) break; }
          const r = yield* this.ex(s.body, proc, fs);
          if (r) { if (r.brk) break; if (!r.cont) return r; }
          if (s.step) yield* this.ev(s.step, proc, fs);
        }
        return;
      }
      case 'switch': {
        yield { line: s.line };
        const v = yield* this.evNum(s.e, proc, scope);
        let start = -1;
        for (let i = 0; i < s.cases.length && start < 0; i++)
          for (const ve of s.cases[i].vals) { const cv = yield* this.evNum(ve, proc, scope); if (cv === v) { start = i; break; } }
        if (start < 0) start = s.cases.findIndex(c => c.isDefault);
        if (start < 0) return;
        const inner = { vars: new Map(), parent: scope };
        for (let i = start; i < s.cases.length; i++)
          for (const st of s.cases[i].body) {
            const r = yield* this.ex(st, proc, inner);
            if (r) { if (r.brk) return; return r; }
          }
        return;
      }
      case 'return': {
        yield { line: s.line };
        let v = 0;
        if (s.e) v = yield* this.evNum(s.e, proc, scope);
        return { ret: true, value: v, hasValue: !!s.e };
      }
      case 'break': yield { line: s.line }; return { brk: true };
      case 'continue': yield { line: s.line }; return { cont: true };
      case 'cobegin': {
        yield { line: s.line };
        if (proc !== this.main || proc.depth !== 1) throw bErr('cobegin solo puede ir directamente dentro de main()', s.line);
        if (proc.spawning) throw bErr('No se puede poner un cobegin dentro de otro', s.line);
        proc.spawning = true;
        const r = yield* this.execBlock(s.body, proc, scope);
        proc.spawning = false;
        if (proc.children > 0) { proc.state = 'cobegin'; yield { line: s.line }; }
        return r;
      }
    }
    throw bErr('Instrucción no soportada', s.line);
  }
  /* Ejecuta un paso. Devuelve false cuando no se puede seguir (fin, error, deadlock o esperando un dato). */
  /* forced (opcional): proceso elegido por el usuario, como al hacer clic en la tabla de jBACI. */
  step(forced) {
    if (this.status === 'input') return false;
    if (this.status !== 'ready' && this.status !== 'running') return false;
    this.status = 'running';
    let p = this.cur;
    const keep = p && p.state === 'ready' && (p.atomic > 0 || this.quantum > 0);
    if (forced && forced.state === 'ready' && !(keep && p.atomic > 0)) {
      p = forced; this.cur = p; this.quantum = 0;
    } else if (!keep) {
      const ready = this.procs.filter(q => q.state === 'ready');
      if (!ready.length) {
        if (this.procs.every(q => q.state === 'done')) { this.status = 'done'; this.cur = null; return false; }
        this.status = 'deadlock'; this.cur = null; return false;
      }
      p = ready[Math.floor(this.rnd() * ready.length)];
      this.cur = p;
      this.quantum = 1 + Math.floor(this.rnd() * 4);
    }
    this.quantum--;
    let r;
    try { r = p.gen.next(); }
    catch (e) {
      this.status = 'error';
      this.error = { msg: e instanceof BaciError ? e.message : 'Error interno: ' + e.message, line: (e && e.line) || p.line, proc: p.name };
      return false;
    }
    this.steps++;
    this.last = p;
    if (r.done) {
      p.state = 'done'; p.line = null;
      if (p.parent) { p.parent.children--; if (p.parent.children === 0 && p.parent.state === 'cobegin') p.parent.state = 'ready'; }
      if (this.procs.every(q => q.state === 'done')) { this.status = 'done'; this.cur = null; return false; }
    } else if (r.value && r.value.line) p.line = r.value.line;
    return this.status !== 'input';
  }
}

const api = { LF, FLAG_INT, FLAG_CHAR, lex, lexProgram, parse, check, compile, cfmt, Machine, BaciError, BUILTINS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.BACI = api;
})(typeof window !== 'undefined' ? window : globalThis);

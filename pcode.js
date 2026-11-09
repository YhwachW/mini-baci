/*
 * Mini BACI: compilador de C-- a PCODE, igual al bacc de BACI (el que usa jBACI).
 *
 * Es una traducción a JavaScript del compilador original de BACI (bac.y, bac.l y
 * computil.c de Bill Bynum y Tracy Camp, basado en el compilador Pascal-S de
 * Ben-Ari / Wirth). Usa las mismas tablas de análisis LALR(1) que generaría yacc,
 * así que pide los tokens en el mismo momento que bacc y produce el mismo PCODE,
 * las mismas tablas y la misma información de depuración (línea de cada instrucción).
 *
 * Además de lo de BACI 2000 agrega lo de la versión que trae jBACI (2004):
 * Linda (postnote, readnote, removenote, readnoteeq, removenoteeq) y los gráficos
 * (create, changecolor, makevisible, moveto, moveby).
 */
(function (root) {
'use strict';

const TABLAS = root.BACI_TABLAS || (typeof require !== 'undefined' ? require('./pcode-tablas.js') : null);

/* ---------------------------------------------------------------- constantes */
const OP = {
  LOAD_ADDR: 0, LOAD_VALUE: 1, LOAD_INDIR: 2, UPDATE_DISPLAY: 3, COBEGIN: 4, COEND: 5, P_WAIT: 6, V_SIGNAL: 7,
  ENTERMON: 8, EXITMON: 9, WAITC: 10, SIGNALC: 11, EMPTY: 12, EOLN_OR_EOF: 13, JUMP: 14, JZER: 15,
  BEGINFOR: 16, ENDFOR: 17, MARKSTACK: 18, CALL: 19, INDEX: 21, LOAD_BLOCK: 22, COPY_BLOCK: 23, PUSH_LIT: 24,
  READ: 27, WRITE_RAWSTRING: 28, WRITE: 29, HALT: 31, EXIT_PROC: 32, EXIT_FCN: 33, VALUE_AT: 34, COMPLEMENT: 35,
  NEGATE: 36, STORE_KEEP: 37, STORE: 38, STORE_SEM: 39, CALL_MONINIT: 40, RET_MONINIT: 41, TEST_EQ_KEEP: 44,
  TEST_EQ: 45, TEST_NE: 46, TEST_LT: 47, TEST_LE: 48, TEST_GT: 49, TEST_GE: 50, DO_OR: 51, DO_ADD: 52, DO_SUB: 53,
  DO_AND: 56, DO_MUL: 57, DO_DIV: 58, DO_MOD: 59, READLN: 62, WRITELN: 63, WHICH_PROC: 71, SUSPEND: 72,
  REVIVE: 73, RANDOM: 74, SHORTCALL: 80, SHORTRET: 81, SSCANF_OP: 90, SPRINTF_OP: 91,
  WRITE_STRING: 110, COPY_RAWSTRING: 111, COPY_STRING: 112, CONCAT_RAWSTRING: 113, CONCAT_STRING: 114,
  COMPARE_RAWSTRING: 115, COMPARE_STRING: 116, LENGTH_STRING: 117,
  CREATE: 120, MAKEVISIBLE: 121, MOVETO: 122, MOVEBY: 123, CHANGECOLOR: 124, POST: 130, REMOVE: 131,
  // distribuidos (BACI 2000): el compilador los acepta, el intérprete no
  SEND_RAWSTRING: 100, SEND_STRING: 101, RECEIVE_OP: 102, BROADCAST_RAWSTRING: 103, BROADCAST_STRING: 104,
  RECEIVE_ID: 105, SEND_INT: 106, BROADCAST_INT: 107,
};
// nombres como los muestra jBACI en la ventana PCode
const OPNAME = {
  0: 'LOAD_ADDR', 1: 'LOAD_VALUE', 2: 'LOAD_INDIR', 3: 'UPDATE_DISPLAY', 4: 'COBEGIN', 5: 'COEND', 6: 'WAIT',
  7: 'SIGNAL', 8: 'ENTER_MONITOR', 9: 'EXIT_MONITOR', 10: 'WAITC', 11: 'SIGNALC', 12: 'EMPTY', 13: 'EOLN_EOF',
  14: 'JUMP', 15: 'JUMP_ZERO', 16: 'BEGIN_FOR', 17: 'END_FOR', 18: 'MARK_STACK', 19: 'CALL', 21: 'INDEX',
  22: 'LOAD_BLOCK', 23: 'COPY_BLOCK', 24: 'PUSH_LITERAL', 27: 'READ', 28: 'WRITE_RAWSTRING', 29: 'WRITE',
  31: 'HALT', 32: 'EXIT_PROC', 33: 'EXIT_FUNCTION', 34: 'VALUE_AT', 35: 'COMPLEMENT', 36: 'NEGATE',
  37: 'STORE_KEEP', 38: 'STORE', 39: 'STORE_SEMAPHORE', 40: 'CALL_MONITOR_INIT', 41: 'RETURN_MONITOR_INIT',
  44: 'TEST_EQUAL_KEEP', 45: 'TEST_EQ', 46: 'TEST_NE', 47: 'TEST_LT', 48: 'TEST_LE', 49: 'TEST_GT', 50: 'TEST_GE',
  51: 'DO_OR', 52: 'DO_ADD', 53: 'DO_SUB', 56: 'DO_AND', 57: 'DO_MULT', 58: 'DO_DIV', 59: 'DO_MOD', 62: 'READLN',
  63: 'WRITELN', 71: 'WHICH_PROC', 72: 'SUSPEND', 73: 'REVIVE', 74: 'RANDOM', 80: 'SHORT_CALL', 81: 'SHORT_RETURN',
  90: 'SSCANF', 91: 'SPRINTF', 110: 'WRITE_STRING', 111: 'COPY_RAWSTRING', 112: 'COPY_STRING',
  113: 'CONCAT_RAWSTRING', 114: 'CONCAT_STRING', 115: 'COMPARE_RAWSTRING', 116: 'COMPARE_STRING',
  117: 'LENGTH_STRING', 120: 'CREATE', 121: 'MAKE_VISIBLE', 122: 'MOVE_TO', 123: 'MOVE_BY', 124: 'CHANGE_COLOR',
  130: 'POST_NOTE', 131: 'REMOVE_NOTE',
};
// OBJTYPE y TYPES de bacicnty.h
const constant = 0, variable = 1, type = 2, procedure = 3, func = 4, monitor = 5, mainproc = 6, outerblock = 7,
  ext_procedure = 8, ext_function = 9, ext_monitor = 10, ext_variable = 11;
const notyp = 0, ints = 1, bools = 2, chars = 3, bsems = 4, sems = 5, conds = 6, arrays = 7, rawstrings = 10, strings = 11;
const SP_INITSEM = 5, SP_PWAIT = 6, SP_VSIGNAL = 7, SP_WAITC = 8, SP_SIGNALC = 9, SP_EXIT = 10, SP_SUSPEND = 11, SP_REVIVE = 12;
const SF_EMPTY = 16, SF_WHICHPROC = 19, SF_RANDOM = 20;
// agregados de jBACI (los números son internos de este compilador)
const SP_POST = 30, SP_READNOTE = 31, SP_REMOVENOTE = 32, SP_READNOTEEQ = 33, SP_REMOVENOTEEQ = 34;
const SP_CREATE = 40, SP_CHANGECOLOR = 41, SP_MAKEVISIBLE = 42, SP_MOVETO = 43, SP_MOVEBY = 44;
const GFX_ARGS = { [SP_CREATE]: 7, [SP_CHANGECOLOR]: 2, [SP_MAKEVISIBLE]: 2, [SP_MOVETO]: 3, [SP_MOVEBY]: 3 };
const GFX_OP = { [SP_CREATE]: OP.CREATE, [SP_CHANGECOLOR]: OP.CHANGECOLOR, [SP_MAKEVISIBLE]: OP.MAKEVISIBLE, [SP_MOVETO]: OP.MOVETO, [SP_MOVEBY]: OP.MOVEBY };
const LINDA_NONE = -32767;
const DEFAULT_PRIO = 10, SIZEOF_INT = 4, ALNG = 12, MAXERROR = 4;
const stacksize = x => Math.ceil(x / SIZEOF_INT);
const COMP_NAME = 'BACI System: C-- to PCODE Compiler, 12:29  18 Jul 2004';

const KEYWORDS = {
  atomic: 'ATOMIC', break: 'BREAK', parbegin: 'CBEGIN', case: 'CASE', char: 'CHAR', cin: 'CIN', cobegin: 'CBEGIN', const: 'CONST',
  continue: 'CONTINUE', cout: 'COUT', default: 'DEFAULT', do: 'DO', else: 'ELSE', endl: 'ENDL', extern: 'EXTERN',
  for: 'FOR', if: 'IF', include: 'INCLUDE', init: 'INIT', int: 'INT', main: 'MAIN', monitor: 'MONITOR',
  return: 'RETURN', sprintf: 'SPRINTF', sscanf: 'SSCANF', string: 'STRING', stringConcat: 'STRINGCONCAT',
  stringCopy: 'STRINGCOPY', stringCompare: 'STRINGCOMPARE', stringLength: 'STRINGLENGTH', switch: 'SWITCH',
  typedef: 'TYPEDEF', void: 'VOID', nbcin: 'NBCIN', while: 'WHILE', send: 'SEND', receive: 'RECEIVE', broadcast: 'BROADCAST',
};
const OPS2 = { '>=': 'GE', '!=': 'NE', '==': 'EQ', '&&': 'AND', '||': 'OR', '++': 'PLPL', '--': 'MIMI', '<<': 'LTLT', '>>': 'GTGT', '<=': 'LE' };
const SINGLE = ';.+-=*%/>()[]{}&|!,#:';

class PcodeError extends Error { constructor(msg, line, file) { super(msg); this.line = line; this.file = file; } }

/* ============================================================== compilador */
function compile(mainSrc, resolve, mainName) {
  mainName = mainName || 'programa.cm';
  /* ----- tablas globales (globdata) ----- */
  const tab = [], atab = [], btab = [], code = [], dbg = [], infile = [];
  let stab = '';
  let lc = 0, last_tab = -1, last_atab = -1, last_btab = 0, last_predeclared = 0;
  const display = [];
  const mtab = []; let mon = -1;
  const lst = [`${COMP_NAME}\n`, `Source file: ${mainName}\n`, ' line  pc\n'];
  const errors = [];
  let errcount = 0;
  let lasttoken = '', laststring = '', numbertext = '', numberbase = 10;
  let curr_infile = -1, include_level = -1;

  function yyerror(msg) {
    const f = infile[curr_infile < 0 ? 0 : curr_infile];
    errcount++;
    const p = lasttoken === '' ? '???' : lasttoken;
    const full = `Error near '${p}', line ${f ? f.line_no : 0} of file ${f ? f.fname : mainName}:\n**   ${msg}`;
    errors.push({ msg, near: p, line: f ? f.line_no : 0, file: f ? f.fname : mainName, fix: curr_infile < 0 ? 0 : curr_infile });
    lst.push(full + ' \n');
    if (errcount >= MAXERROR) throw new PcodeError(`Compilation aborted.  Too many (${MAXERROR}) errors.`, f ? f.line_no : 0, f ? f.fname : mainName);
  }
  function cfatal(msg) { const f = infile[Math.max(0, curr_infile)]; throw new PcodeError(msg, f ? f.line_no : 0, f ? f.fname : mainName); }

  /* ----- archivos de entrada y lectura por líneas (bac.l: nextch) ----- */
  function splitLines(src) {
    const s = String(src).replace(/\r\n?/g, '\n');
    if (s === '') return [];
    const L = s.split('\n');
    const out = L.map((x, i) => (i < L.length - 1 ? x + '\n' : x));
    if (out[out.length - 1] === '') out.pop(); else out[out.length - 1] += '\n';
    return out;
  }
  function open_infile(fname, text) {
    const tcif = curr_infile;
    if (tcif >= 0) {
      dbg.push({ lc, fix: tcif, flno: infile[tcif].line_no });
      infile[tcif].last_line_no = infile[tcif].line_no;
    }
    infile.push({ fname, line_no: 0, last_line_no: 0, parent: tcif, lines: splitLines(text), li: 0, buf: '', pos: 0 });
    include_level++;
    return infile.length - 1;
  }
  function close_infile(ci) {
    if (ci < 0) return ci;
    // bacc anota el cierre del archivo principal en la última instrucción (lc - 1)
    dbg.push({ lc: infile[ci].parent < 0 ? Math.max(lc - 1, 0) : lc, fix: ci, flno: -infile[ci].line_no });
    include_level--;
    return infile[ci].parent;
  }
  // devuelve el siguiente carácter, o '' al final del archivo actual
  function nextch() {
    const f = infile[curr_infile];
    if (f.pos < f.buf.length) return f.buf[f.pos++];
    if (f.li >= f.lines.length) return '';
    f.buf = f.lines[f.li++]; f.pos = 0;
    f.line_no++;
    lst.push('>'.repeat(Math.max(0, include_level)) + `${String(f.line_no).padStart(4)} ${String(lc).padStart(4)}  ${f.buf}`);
    return f.buf[f.pos++];
  }
  const peekch = () => { const f = infile[curr_infile]; return f.pos < f.buf.length ? f.buf[f.pos] : null; };
  function unput() { infile[curr_infile].pos--; }

  function get_escape() {
    let esc = 0, c = nextch();
    if (c === 'x' || c === 'X') {
      for (;;) {
        c = nextch();
        if (/[0-9]/.test(c)) esc = (16 * esc + (c.charCodeAt(0) - 48)) & 255;
        else if (/[a-f]/.test(c)) esc = (16 * esc + c.charCodeAt(0) - 87) & 255;
        else if (/[A-F]/.test(c)) esc = (16 * esc + c.charCodeAt(0) - 55) & 255;
        else { if (c) unput(); break; }
      }
    } else {
      for (;;) {
        if (c >= '0' && c <= '7') { esc = 8 * esc + (c.charCodeAt(0) - 48); c = nextch(); }
        else { if (c) unput(); break; }
      }
    }
    return String.fromCharCode(esc < 256 ? esc : 0x20);
  }
  function get_string(termch) {
    let s = '', c;
    while ((c = nextch())) {
      if (c === termch) { laststring = s; return; }
      if (c === '\\') {
        c = nextch();
        const m = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
        if (c in m) s += m[c];
        else if (c === '0') s += get_escape();
        else s += c;
      } else if (c === '\n' || c === '\x0c' || c === '\r') { laststring = s; yyerror('Non-terminated string'); return; }
      else s += c;
    }
    laststring = s;
  }

  let in_include = 0;
  // un token: { t: nombre del símbolo en la gramática, v: valor, line, fix }
  function yylex() {
    for (;;) {
      const c = nextch();
      if (c === '') {
        curr_infile = close_infile(curr_infile);
        if (curr_infile < 0) return { t: '$end' };
        lst.push(`Returning to file ${infile[curr_infile].fname}\n`);
        continue;
      }
      if (c === '\n' || c === ' ' || c === '\t' || c === '\x1a') continue;
      if (c === '/' && peekch() === '/') { let d; do { d = nextch(); } while (d && d !== '\n'); continue; }
      if (c === '/' && peekch() === '*') {
        nextch();
        let d, last = ' ';
        while ((d = nextch())) { if (last === '*' && d === '/') break; last = d; }
        if (!d) yyerror('open comment at end-of-file');
        continue;
      }
      const two = c + (peekch() || '');
      if (OPS2[two]) { nextch(); lasttoken = two; return { t: OPS2[two] }; }
      if (/[A-Za-z_]/.test(c)) {
        let w = c; while (/[A-Za-z0-9_]/.test(peekch() || '')) w += nextch();
        lasttoken = w;
        if (Object.prototype.hasOwnProperty.call(KEYWORDS, w)) return { t: KEYWORDS[w] };
        return { t: 'IDENTIFIER', v: w };
      }
      if (c === '<') {
        if (in_include) { get_string('>'); lasttoken = laststring; return { t: 'FNSTRING', v: laststring }; }
        lasttoken = c; return { t: "'<'" };
      }
      if (c === '"') { get_string('"'); lasttoken = laststring; return in_include ? { t: 'FNSTRING', v: laststring } : { t: 'RAWSTRING' }; }
      if (c >= '0' && c <= '9') {
        let w = c;
        if (c === '0' && (peekch() === 'x' || peekch() === 'X')) {
          const save = infile[curr_infile].pos; nextch();
          if (/[0-9a-fA-F]/.test(peekch() || '')) {
            w = ''; while (/[0-9a-fA-F]/.test(peekch() || '')) w += nextch();
            numbertext = w; numberbase = 16; lasttoken = '0x' + w; return { t: 'UNSIGNED_INT' };
          }
          infile[curr_infile].pos = save;
        }
        while (/[0-9]/.test(peekch() || '')) w += nextch();
        numbertext = w; numberbase = c === '0' ? 8 : 10; lasttoken = w;
        return { t: 'UNSIGNED_INT' };
      }
      if (c === "'") {
        get_string("'"); lasttoken = laststring;
        if (laststring.length > 1) yyerror('invalid character constant');
        return { t: 'CHARCON' };
      }
      if (SINGLE.includes(c)) { lasttoken = c; return { t: `'${c}'` }; }
      lasttoken = c;
      yyerror(`Illegal character '\\${c.charCodeAt(0).toString(16)}'`);
    }
  }

  /* ----- utilidades (computil.c) ----- */
  function enterstid(name, obj, typ, adr) {
    last_tab++;
    tab[last_tab] = { name: name.slice(0, ALNG), link: last_tab - 1, obj, typ, ref: 0, normal: 1, lev: -1, adr, mon: 0, atomic: 0 };
    btab[0].last = last_tab;
  }
  function enter(id, obj, level, vislevel) {
    const name = id.slice(0, ALNG);
    tab[0].name = name;
    let j = btab[display[vislevel]].last; const l = j;
    while (tab[j].name !== name) j = tab[j].link;
    if (j !== 0 && tab[j].lev === vislevel) { yyerror(`Duplicate identifier '${name}' at level ${vislevel}`); return 0; }
    last_tab++;
    tab[last_tab] = { name, link: l, obj, typ: notyp, normal: 1, lev: level, ref: 0, adr: 0, mon: 0, atomic: 0 };
    btab[display[vislevel]].last = last_tab;
    return last_tab;
  }
  function loc(id, level) {
    const name = id.slice(0, ALNG);
    tab[0].name = name;
    let i = level, j;
    do {
      j = btab[display[i]].last;
      while (tab[j].name !== name) j = tab[j].link;
      i--;
    } while (i >= 0 && j === 0);
    if (j === 0) { yyerror(`Undeclared identifier '${name}' at level ${level}`); return 0; }
    return j;
  }
  function enter_block(t) {
    if (++level > 7) cfatal('Maximum nesting level of 7 exceeded');
    last_btab++;
    btab[last_btab] = { last: 0, lastpar: 0, psize: 5, vsize: 5 };
    display[level] = last_btab;
    tab[t].ref = last_btab;
  }
  function leave_block() { if (level > 0) level--; else cfatal('Attempt to decrement below 0 level'); }
  function emit2(f, x, y) {
    const fi = infile[curr_infile];
    if (curr_infile >= 0 && fi && fi.line_no > fi.last_line_no) {
      dbg.push({ lc, fix: curr_infile, flno: fi.line_no });
      fi.last_line_no = fi.line_no;
    }
    code[lc] = { f, x, y };
    lc++;
  }
  const emit = f => emit2(f, 0, 0);
  const emit1 = (f, y) => emit2(f, 0, y);
  function get_constant(id, level) {
    const i = loc(id, level);
    if (i === 0) { consttype = notyp; return 0; }
    if (tab[i].obj !== constant) { yyerror(`Identifier '${tab[i].name}' not of constant type`); consttype = notyp; return 0; }
    consttype = tab[i].typ;
    return tab[i].adr;
  }
  const new_expr = () => ({ obj: constant, typ: notyp, adr: 0, ref: 0, lev: 0, normal: 0, arelt: 0, isval: 0, tix: 0 });
  const NOEXPR = new_expr();
  const X = e => (e && typeof e === 'object' ? e : NOEXPR);
  function index_expr(e, st) {
    if (st.aref >= 0) {
      const a = atab[st.aref] || { inxtyp: notyp, eltyp: notyp, elref: 0 };
      if (a.inxtyp !== e.typ) yyerror('Type conflict in array index');
      emit1(OP.INDEX, st.aref);
      st.eltyp = a.eltyp; st.aref = a.elref;
    }
  }
  function gen_loadvar(e) {
    let f;
    if (e.typ === arrays || e.typ === strings) f = e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE;
    else f = e.normal ? OP.LOAD_VALUE : OP.LOAD_INDIR;
    emit2(f, e.lev, e.adr);
  }
  function gen_exprval(e) {
    e = X(e);
    if (e.isval) return;
    e.isval = 1;
    if (e.arelt) { if (e.typ !== arrays && e.typ !== strings) emit(OP.VALUE_AT); e.arelt = 0; return; }
    switch (e.obj) {
      case constant: emit1(OP.PUSH_LIT, e.adr); break;
      case ext_variable: case variable: gen_loadvar(e); break;
      case ext_function: case func: break;
      default: yyerror("A 'proc', 'monitor', or 'type' cannot appear in an expression");
    }
  }
  const emit_push_addr = x => emit2(x.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, x.lev, x.adr);
  function proc_parm(px, e, pct) {
    const cp = px + pct, lp = btab[tab[px].ref].lastpar;
    if (cp > lp && first_parmcterr) { yyerror('More actual parameters than formal parameters'); first_parmcterr = 0; }
    else if (e.typ === strings) { if (!e.arelt) emit2(OP.LOAD_ADDR, e.lev, e.adr); }
    else if (cp > lp) { /* ya se informó */ }
    else if (tab[cp].normal) {
      gen_exprval(e);
      if (e.typ === tab[cp].typ) { if (e.typ === arrays) emit1(OP.LOAD_BLOCK, atab[e.ref] ? atab[e.ref].size : 0); }
      else if (e.typ !== notyp) yyerror('Parameter type mismatch');
    } else {
      if (e.obj !== variable) yyerror("Reference (VAR) parameter must be a 'variable'");
      if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
    }
  }
  let binsem = 0, lindaBits = 0;
  function lindaKind(adr) { return adr === SP_POST ? 'post' : (adr >= SP_READNOTE && adr <= SP_REMOVENOTEEQ) ? 'read' : null; }
  function stdproc_parm(px, e, pct) {
    let too_many = 0;
    const t = tab[px];
    if (e.eqmark && lindaKind(t.adr) !== 'read') yyerror('syntax error');
    if (t.obj === procedure) {
      switch (t.adr) {
        case SP_INITSEM:
          if (pct === 1) {
            if (e.obj !== variable) yyerror("Parameter must be a 'variable'");
            else if (e.typ !== sems && e.typ !== bsems) yyerror("Parameter must be a 'semaphore'");
            else binsem = e.typ === bsems ? 1 : 0;
            if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
          } else if (pct === 2) {
            if (e.typ === ints) { gen_exprval(e); emit1(OP.STORE_SEM, binsem); }
            else yyerror("Parameter must be of type 'int' (or 'integer')");
          } else too_many = 1;
          break;
        case SP_PWAIT: case SP_VSIGNAL:
          if (pct === 1) {
            if (e.obj !== variable) yyerror("Parameter must be a 'variable'");
            else if (e.typ !== sems && e.typ !== bsems) yyerror("Parameter must be a 'semaphore'");
            else {
              if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
              emit1(t.adr === SP_PWAIT ? OP.P_WAIT : OP.V_SIGNAL, e.typ === bsems ? 1 : 0);
            }
          } else too_many = 1;
          break;
        case SP_SIGNALC:
          if (pct === 1) {
            if (e.obj !== variable) yyerror("Parameter must be a 'variable'");
            else if (e.typ !== conds) yyerror("Parameter must be a 'condition'");
            else if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
          } else too_many = 1;
          break;
        case SP_WAITC:
          if (pct === 1) {
            if (e.obj !== variable) yyerror("Parameter must be a 'variable'");
            else if (e.typ !== conds) yyerror("Parameter must be a 'condition'");
            if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
          } else if (pct === 2) {
            if (e.typ !== ints) yyerror("Parameter must be of type 'int' (or 'integer')");
            else gen_exprval(e);
          } else too_many = 1;
          break;
        case SP_EXIT: if (pct > 2) too_many = 1; break;
        case SP_SUSPEND: if (pct > 0) too_many = 1; break;
        case SP_REVIVE:
          if (pct === 1) { if (e.typ !== ints) yyerror("Parameter must be of type 'int' (or 'integer')"); else gen_exprval(e); }
          else too_many = 1;
          break;
        case SP_POST: case SP_READNOTE: case SP_REMOVENOTE: case SP_READNOTEEQ: case SP_REMOVENOTEEQ:
          if (pct > 3) { yyerror('Only three Linda parameters allowed'); break; }
          if (pct === 1) {
            lindaBits = 0;
            if (e.typ !== chars && e.typ !== notyp) yyerror('first Linda parameter must be of char type');
            gen_exprval(e);
          } else if (t.adr === SP_POST) {
            if (e.typ !== ints && e.typ !== notyp) yyerror('other Linda parameters must be of integer type');
            gen_exprval(e);
          } else {
            if (e.typ !== ints && e.typ !== notyp) yyerror('other Linda parameters must be of integer type');
            else if (e.obj !== variable) yyerror('other Linda parameters must be variables');
            else emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr);
            if (e.eqmark) lindaBits |= (pct === 2 ? 1 : 2);
          }
          break;
        case SP_CREATE: case SP_CHANGECOLOR: case SP_MAKEVISIBLE: case SP_MOVETO: case SP_MOVEBY:
          if (pct > GFX_ARGS[t.adr]) too_many = 1;
          else if (e.typ !== ints && e.typ !== notyp) yyerror("Parameter must be of type 'int' (or 'integer')");
          else gen_exprval(e);
          break;
      }
    } else if (t.obj === func) {
      switch (t.adr) {
        case SF_EMPTY:
          if (pct === 1) {
            if (e.obj !== variable) yyerror('Parameter must be a VARIABLE');
            else if (e.typ === conds) { if (!e.arelt) emit2(e.normal ? OP.LOAD_ADDR : OP.LOAD_VALUE, e.lev, e.adr); }
            else yyerror("Parameter must be a 'condition'");
          } else too_many = 1;
          break;
        case SF_WHICHPROC: if (pct > 0) too_many = 1; break;
        case SF_RANDOM:
          if (pct === 1) { if (e.typ !== ints) yyerror("Parameter must be of type 'int' (or 'integer')"); else gen_exprval(e); }
          else too_many = 1;
          break;
      }
    }
    if (too_many && first_parmcterr) { yyerror('Too many actual parameters'); first_parmcterr = 0; }
  }
  function stdproc_pcode(px, pct) {
    let too_few = 0;
    const t = tab[px];
    if (t.obj === procedure) {
      switch (t.adr) {
        case SP_INITSEM: case SP_PWAIT: case SP_VSIGNAL: too_few = pct === 0; break;
        case SP_SIGNALC: emit(OP.SIGNALC); too_few = pct === 0; break;
        case SP_WAITC: if (pct === 1) emit1(OP.PUSH_LIT, DEFAULT_PRIO); emit(OP.WAITC); too_few = pct === 0; break;
        case SP_EXIT: emit(OP.HALT); break;
        case SP_SUSPEND: emit(OP.SUSPEND); break;
        case SP_REVIVE: emit(OP.REVIVE); too_few = pct === 0; break;
        case SP_POST: case SP_READNOTE: case SP_REMOVENOTE: case SP_READNOTEEQ: case SP_REMOVENOTEEQ: {
          if (pct === 0) { yyerror('One parameter is required'); break; }
          for (let i = Math.min(pct, 3); i < 3; i++) emit1(OP.PUSH_LIT, LINDA_NONE);
          if (t.adr === SP_POST) emit(OP.POST);
          else {
            const eq = t.adr === SP_READNOTEEQ || t.adr === SP_REMOVENOTEEQ;
            emit2(OP.REMOVE, (t.adr === SP_READNOTE || t.adr === SP_READNOTEEQ) ? 1 : 0, eq ? 3 : lindaBits);
          }
          break;
        }
        case SP_CREATE: case SP_CHANGECOLOR: case SP_MAKEVISIBLE: case SP_MOVETO: case SP_MOVEBY:
          if (pct < GFX_ARGS[t.adr]) yyerror('Too few actual parameters');
          emit(GFX_OP[t.adr]);
          break;
      }
    } else if (t.obj === func) {
      switch (t.adr) {
        case SF_EMPTY: emit(OP.EMPTY); too_few = pct === 0; break;
        case SF_WHICHPROC: emit(OP.WHICH_PROC); break;
        case SF_RANDOM: emit(OP.RANDOM); too_few = pct === 0; break;
      }
    }
    if (too_few) yyerror('One parameter is required');
  }
  function resulttype(a, b) {
    if (a > ints || b > ints) { yyerror("type 'int' (or 'integer') expected"); return notyp; }
    if (a === notyp || b === notyp) return notyp;
    return ints;
  }
  function strtoi(str, base) {
    let tmp = 0;
    for (const ch of str) {
      const d = parseInt(ch, 16);
      if (isNaN(d) || d >= base) { yyerror(base === 8 ? 'invalid octal digit' : base === 16 ? 'invalid hexadecimal digit' : 'invalid decimal digit'); return 0; }
      tmp = (tmp * base + d) >>> 0;
    }
    return tmp | 0;
  }
  function store_string(str) {
    let t = 0;
    while (t < stab.length) {
      const end = stab.indexOf('\0', t);
      const s = stab.slice(t, end < 0 ? stab.length : end);
      if (s === str) return t;
      t = (end < 0 ? stab.length : end) + 1;
    }
    const old = stab.length;
    stab += laststring + '\0';
    return old;
  }

  /* ----- estado del analizador (bac.y) ----- */
  let level = 0, consttype = notyp;
  const arstack = []; let topars = -1, last_aref = 0, last_eltyp = notyp;
  const pfstack = []; let toppfs = -1, last_pf = 0, parmct = 0, prt = 0;
  let in_cobegin = 0, by_value = 0, main_declared = 0, making_objfile = 0;
  let elem_size = 0, elem_typ = notyp, elem_ref = 0, elem_tix = 0, curr_parm_offset = 0, delta_vsize = 0;
  let assign_cnt = 0, in_func_decl = 0, void_function = 0, func_tab = 0;
  const break_loc = []; let curr_break = -1;
  const cont_loc = []; let curr_cont = -1;
  const break_block = []; let break_level = -1;
  const case_loc = []; let curr_case = -1;
  const switch_block = {}; let switch_level = -1;
  let case_hdr_cnt = 0, first_case_hdr = -1;
  const for_info = []; let curr_for = -1;
  const return_loc = []; let curr_ret = -1;
  const var_init = []; let curr_var = -1;
  let in_mon_decl = 0, char_loc = 0, int_loc = 0, ob_tix = 0, outer_call_lc = 0, extern_decl = 0, in_typedef = 0;
  let varargs_cnt = 0, array_defined = 0, first_parmcterr = 1, first_stringerr = 1;
  const NO_EXPR = -1;

  function enter_break_block(bbt) { break_level++; break_block[break_level] = { first_break: -1, first_cont: -1, bb_type: bbt }; }
  function leave_break_block() {
    if (break_level < 0) { curr_cont = curr_break = -1; return; }
    const b = break_block[break_level];
    if (b.first_cont >= 0) curr_cont = b.first_cont - 1;
    if (b.first_break >= 0) curr_break = b.first_break - 1;
    break_level--;
  }
  function process_breaks() {
    if (break_level < 0) return;
    const b = break_block[break_level];
    if (b.first_break < 0) return;
    for (let i = b.first_break; i <= curr_break; i++) code[break_loc[i]].y = lc;
  }
  function process_continues(target) {
    if (break_level < 0) return;
    const b = break_block[break_level];
    if (b.first_cont < 0) return;
    for (let i = b.first_cont; i <= curr_cont; i++) code[cont_loc[i]].y = target;
  }
  function process_returns() { for (let i = 0; i <= curr_ret; i++) code[return_loc[i]].y = lc; }
  function process_var_inits(levl) {
    for (let i = 0; i <= curr_var; i++) {
      if (levl === var_init[i].lev) {
        const t = tab[var_init[i].tix];
        emit2(OP.LOAD_ADDR, t.lev, t.adr);
        emit1(OP.PUSH_LIT, var_init[i].value);
        emit(OP.STORE);
        var_init[i].lev = -1;
      }
    }
  }
  function exprFromTab(i) {
    const t = tab[i] || tab[0];
    const e = new_expr();
    e.obj = t.obj; e.typ = t.typ; e.adr = t.adr; e.ref = t.ref; e.lev = t.lev; e.normal = t.normal; e.tix = i;
    return e;
  }
  function funcResult() {
    const e = new_expr();
    e.obj = func; e.typ = ints; e.normal = 1; e.ref = 0; e.adr = e.lev = -1;
    return e;
  }
  function rawExpr() {
    const e = new_expr();
    e.obj = variable; e.typ = rawstrings; e.adr = store_string(laststring); e.ref = 1 + laststring.length; e.normal = 1; e.tix = -1;
    return e;
  }
  function stringParmToStack(e) { if (e.typ === strings) { if (!e.arelt) emit_push_addr(e); } else if (e.typ === ints) gen_exprval(e); return e; }

  /* ----- acciones semánticas, por regla ----- */
  const A = {
    'program : init_outerscope outer_decls opt_main_decl': () => { if (!making_objfile && !main_declared) yyerror("No 'main' function declared"); if (main_declared) emit(OP.SHORTRET); },
    'program : init_outerscope opt_main_decl': () => { if (!making_objfile && !main_declared) yyerror("No 'main' function declared"); if (main_declared) emit(OP.SHORTRET); },
    'init_outerscope : ': () => {
      level = 0; extern_decl = 0;
      enter('++-outer-++', outerblock, level, level);
      ob_tix = last_tab; tab[ob_tix].adr = lc;
      tab[ob_tix].ref = last_btab = 0;
      btab[0].lastpar = 0; btab[0].psize = btab[0].vsize = 0;
      display[0] = 0;
    },
    'include_decl : start_include FNSTRING': () => {
      const name = laststring;
      if (name === infile[curr_infile].fname) yyerror('Recursive file inclusion');
      else {
        const key = name.replace(/^.*[\\/]/, '').toLowerCase();
        const text = resolve ? resolve(key, name) : null;
        if (text == null) cfatal(`Can't open file ${name}`);
        curr_infile = open_infile(name, text);
      }
      in_include = 0;
    },
    'start_include : \'#\' INCLUDE': () => { in_include = 1; },
    'opt_main_decl : ': () => {
      tab[ob_tix].adr = lc;
      for (let i = 0; i <= mon; i++) { emit1(OP.MARKSTACK, mtab[i] - last_predeclared); emit(OP.CALL_MONINIT); }
      process_var_inits(level);
    },
    'opt_main_decl : main_hdr compound_stmt': v => {
      emit(OP.HALT);
      btab[tab[v[0]].ref].last = last_tab;
      code[outer_call_lc].y = lc;
      tab[ob_tix].adr = lc;
      for (let i = 0; i <= mon; i++) { emit1(OP.MARKSTACK, mtab[i] - last_predeclared); emit(OP.CALL_MONINIT); }
      process_var_inits(level);
      process_var_inits(level - 1);
    },
    'main_hdr : opt_main_type MAIN \'(\' \')\'': () => {
      extern_decl = 0;
      enter('main', mainproc, level, level);
      prt = last_tab;
      enter_block(last_tab);
      btab[last_btab].lastpar = last_tab;
      main_declared = 1;
      btab[0].lastpar = prt;
      tab[prt].adr = lc;
      outer_call_lc = lc;
      emit(OP.SHORTCALL);
      return prt;
    },
    'opt_main_type : INT': () => int_loc,
    'function_decl : func_proto compound_stmt': v => {
      if (main_declared) yyerror('main() proc must be last');
      if (void_function) { if (tab[v[0]].mon) emit(OP.EXITMON); emit(OP.EXIT_PROC); }
      else { process_returns(); if (tab[v[0]].mon) emit(OP.EXITMON); emit(OP.EXIT_FCN); }
      const b = btab[tab[v[0]].ref];
      if (b && b.last === 0) b.last = b.lastpar;
      leave_block();
      in_func_decl = 0; curr_ret = -1;
    },
    'func_proto : func_hdr': v => { tab[v[0]].atomic = 0; },
    'func_proto : ATOMIC func_hdr': v => { tab[v[1]].atomic = 1; return v[1]; },
    'func_hdr : untyped_func_hdr': () => { btab[display[level]].psize = curr_parm_offset; btab[display[level]].vsize = curr_parm_offset + delta_vsize; in_func_decl = 1; },
    'func_hdr : typed_func_hdr': () => { btab[display[level]].psize = curr_parm_offset; btab[display[level]].vsize = curr_parm_offset + delta_vsize; in_func_decl = 1; },
    'untyped_func_hdr : function_id formal_params': v => { tab[v[0]].typ = ints; tab[v[1]] && (tab[v[1]].obj = extern_decl ? ext_function : func); void_function = 0; },
    'typed_func_hdr : VOID function_id formal_params': v => { tab[v[1]].typ = notyp; tab[v[1]].obj = extern_decl ? ext_procedure : procedure; void_function = 1; return v[1]; },
    'typed_func_hdr : var_typespec function_id formal_params': v => {
      const ts = tab[v[0]];
      if (!ts || (ts.typ !== ints && ts.typ !== chars)) { yyerror(`'${ts ? ts.name : ''}' is not a valid function return type`); tab[v[1]].typ = notyp; }
      else tab[v[1]].typ = ts.typ;
      tab[v[1]].obj = extern_decl ? ext_function : func;
      void_function = 0;
      return v[1];
    },
    'function_id : IDENTIFIER': v => {
      lindaReserved(v[0]);
      let vis, real;
      if (in_mon_decl) { real = level; vis = level > 0 ? level - 1 : 0; } else vis = real = level;
      const r = prt = enter(v[0], func, real, vis);
      func_tab = prt;
      if (in_mon_decl) tab[prt].mon = mtab[mon] - last_predeclared;
      enter_block(prt);
      curr_parm_offset = btab[display[level]].vsize;
      delta_vsize = curr_parm_offset - btab[display[level]].psize;
      tab[r].adr = extern_decl ? -1 : lc;
      if (in_mon_decl && !extern_decl) emit1(OP.ENTERMON, tab[prt].mon);
      return r;
    },
    'formal_params : \'(\' param_list \')\'': () => { btab[display[level]].lastpar = last_tab; },
    'param_group : param_typespec newident': v => {
      const t = tab[v[1]];
      t.typ = elem_typ; t.ref = elem_ref; t.obj = variable; t.lev = level; t.normal = by_value; t.adr = curr_parm_offset;
      curr_parm_offset += by_value ? elem_size : 1;   // jBACI: un parámetro por referencia ocupa una palabra
    },
    'param_typespec : var_typespec': () => { by_value = 1; },
    'param_typespec : var_typespec \'&\'': () => { by_value = 0; },
    'param_typespec : STRING': () => { elem_ref = 0; elem_size = 1; elem_typ = strings; elem_tix = -1; by_value = 0; },
    'monitor_decl : monitor_hdr \'{\' mon_internal_decls \'}\'': () => { leave_block(); in_mon_decl = 0; },
    'monitor_hdr : MONITOR newident': v => {
      if (mon === 20) cfatal('No more than 20 monitors can be declared');
      tab[v[1]].obj = extern_decl ? ext_monitor : monitor;
      mtab[++mon] = v[1];
      in_mon_decl = 1;
      if (level > 0) yyerror('Monitors can only be declared at the global level');
      enter_block(last_tab);
      btab[last_btab].lastpar = last_tab;
      return v[1];
    },
    'monitor_init : ': () => { tab[mtab[mon]].adr = lc; process_var_inits(level); emit(OP.RET_MONINIT); },
    'monitor_init : the_init \'{\' stmt_list \'}\'': () => { emit(OP.RET_MONINIT); },
    'the_init : INIT': () => { tab[mtab[mon]].adr = lc; process_var_inits(level); },
    'extern_mon_spec : monitor_hdr \'{\' mon_func_protos \'}\'': v => { leave_block(); tab[v[0]].adr = -1; extern_decl = 0; in_mon_decl = 0; },
    'mon_func_protos : func_proto \';\'': () => { leave_block(); },
    'mon_func_protos : mon_func_protos func_proto \';\'': () => { leave_block(); },
    'var_ext_decl : extern_decl': () => { if (level > 0) yyerror('Externals must be declared at the outer (global) level'); },
    'var_typespec : INT': () => { elem_tix = int_loc; elem_size = stacksize(tab[int_loc].adr); elem_typ = tab[int_loc].typ; elem_ref = tab[int_loc].ref; return int_loc; },
    'var_typespec : CHAR': () => { elem_tix = char_loc; elem_size = stacksize(tab[char_loc].adr); elem_typ = tab[char_loc].typ; elem_ref = tab[char_loc].ref; return char_loc; },
    'var_typespec : STRING \'[\' unsigned_const \']\'': v => {
      if (v[2] <= 0) yyerror('A string of non-positive length is not valid');
      else { elem_ref = elem_size = stacksize(1 + v[2]); elem_typ = strings; elem_tix = -1; }
      return -1;
    },
    'var_typespec : ident': v => {
      const t = tab[v[0]];
      if (t.obj !== type) yyerror(`'${t.name}' is not a valid type`);
      elem_size = stacksize(t.adr); elem_typ = t.typ; elem_ref = t.ref; elem_tix = v[0];
    },
    'var_name : newident': v => {
      const t = tab[v[0]];
      t.typ = elem_typ; t.obj = extern_decl ? ext_variable : variable; t.ref = elem_ref;
      t.adr = btab[display[level]].vsize; btab[display[level]].vsize += elem_size;
    },
    'var_name : newident \'=\' constant': v => {
      if (extern_decl) { yyerror('External variables cannot be initialized'); return; }
      const t = tab[v[0]], val = v[2];
      t.typ = elem_typ; t.obj = variable; t.ref = elem_ref;
      t.adr = btab[display[level]].vsize; btab[display[level]].vsize += elem_size;
      if (t.typ === conds) yyerror("Cannot assign to a 'condition'");
      else if (t.typ === bsems) { if (val < 0 || val > 1) yyerror('A binary semaphore can only become 0 or 1'); }
      else if (t.typ === sems) { if (val < 0) yyerror('A semaphore cannot be negative'); }
      else if (t.typ !== ints && t.typ !== chars) yyerror("'int' or 'char' type expected");
      else if (t.typ !== consttype) yyerror('Type mismatch in assignment');
      if ((in_mon_decl && !in_func_decl) || (level === 0 && !main_declared)) {
        var_init[++curr_var] = { value: val, lev: level, tix: v[0] };
      } else {
        emit2(OP.LOAD_ADDR, t.lev, t.adr); emit1(OP.PUSH_LIT, val); emit(OP.STORE);
      }
    },
    'var_name : array_decl': () => { in_typedef = 0; },
    'array_decl : newident index_list': v => {
      let elsize = elem_size, eltyp = elem_typ, elref = eltyp === arrays ? elem_ref : 0;
      const t = tab[v[0]];
      t.obj = extern_decl ? ext_variable : variable; t.typ = arrays; t.ref = v[1];
      for (let i = last_atab; i >= v[1]; i--) {
        const a = atab[i];
        a.elref = elref; a.elsize = elsize; a.size = (1 + a.high - a.low) * elsize;
        elsize = a.size; a.eltyp = eltyp; eltyp = arrays; elref = i;
      }
      t.adr = btab[display[level]].vsize;
      if (!in_typedef) btab[display[level]].vsize += elsize;
      array_defined = v[0];
      return v[1];
    },
    'index_list : index': v => v[0],
    'index : \'[\' unsigned_const \']\'': v => {
      if (last_atab === 50) cfatal('Array table full with 50 entries');
      const a = atab[++last_atab] = { inxtyp: consttype, eltyp: notyp, elref: 0, low: 0, high: 0, elsize: 0, size: 0 };
      if (v[1] < 0) { yyerror(`Array bound ${v[1]} less than zero`); a.high = 0; } else a.high = v[1] - 1;
      a.low = 0;
      return last_atab;
    },
    'type_decl : the_typedef var_typespec newident \';\'': v => {
      if (v[2] > 0) { const t = tab[v[2]], s = tab[v[1]] || {}; t.obj = type; t.typ = s.typ; t.ref = s.ref; t.adr = s.adr; }
      return v[2];
    },
    'type_decl : the_typedef var_typespec array_decl \';\'': v => {
      if (array_defined > 0) { const t = tab[array_defined]; t.obj = type; t.typ = arrays; t.ref = v[2]; t.adr = SIZEOF_INT * atab[v[2]].size; }
      in_typedef = 0;
      return array_defined;
    },
    'the_typedef : TYPEDEF': () => { in_typedef = 1; },
    'const_decl : CONST var_typespec newident \'=\' constant \';\'': v => {
      const s = tab[v[1]];
      if (!s || (s.typ !== ints && s.typ !== chars)) yyerror("Constants must be of type 'int' or 'char'");
      else { const t = tab[v[2]]; t.typ = s.typ; t.adr = v[4]; t.ref = 0; }
    },
    'constant : unsigned_const': v => v[0],
    'constant : \'-\' unsigned_const': v => -v[1],
    'constant : \'+\' unsigned_const': v => v[1],
    'constant : CHARCON': () => { consttype = chars; return laststring.charCodeAt(0) || 0; },
    'unsigned_const : unsigned_num': v => { consttype = ints; return v[0]; },
    'unsigned_const : ident': v => {
      const r = get_constant(tab[v[0]].name, level);
      if (consttype !== ints && consttype !== chars) { yyerror("'int' or 'char' type expected"); consttype = notyp; }
      return r;
    },
    'unsigned_num : UNSIGNED_INT': () => strtoi(numbertext, numberbase),
    'extern_func_decl : the_extern func_proto \';\'': () => { leave_block(); in_func_decl = 0; extern_decl = 0; },
    'the_extern : EXTERN': () => { extern_decl = 1; },
    'extern_var_decl : the_extern var_decl': () => { extern_decl = 0; },
    'extern_array_decl : the_extern array_decl': () => { extern_decl = 0; in_typedef = 0; },
    'extern_mon_decl : the_extern extern_mon_spec': () => { extern_decl = 0; },
    'stmt : iteration_stmt': v => { process_breaks(); process_continues(v[0]); leave_break_block(); },
    'send_call : SEND left_exprparm \',\' expr \')\' \';\'': v => {
      const r = funcResult(), a = X(v[1]), b = X(v[3]);
      if (b.typ !== ints) yyerror("right parameter is not of type 'int'");
      else {
        gen_exprval(b);
        if (a.typ === rawstrings) emit1(OP.SEND_RAWSTRING, a.adr);
        else if (a.typ === ints) emit(OP.SEND_INT);
        else if (a.typ === strings) emit(OP.SEND_STRING);
        else yyerror("parameter is not 'rawstring', 'string', or 'int'");
      }
      return r;
    },
    'left_exprparm : \'(\' rawstring_parm': v => v[1],
    'left_exprparm : \'(\' expr': v => {
      const e = X(v[1]);
      if (e.typ === strings) { if (!e.arelt) emit_push_addr(e); }
      else if (e.typ === ints) gen_exprval(e);
      return v[1];
    },
    'broadcast_call : BROADCAST single_exprparm': v => {
      const e = X(v[1]);
      if (e.typ === rawstrings) emit1(OP.BROADCAST_RAWSTRING, e.adr);
      else if (e.typ === strings) emit(OP.BROADCAST_STRING);
      else if (e.typ === ints) emit(OP.BROADCAST_INT);
      else yyerror("parameter is not 'rawstring', 'string', or 'int'");
    },
    'sprintf_call : sprintf_buf_fmt \',\' sprintf_parmlist \')\'': v => { emit1(OP.PUSH_LIT, varargs_cnt); emit1(OP.SPRINTF_OP, v[0]); },
    'sprintf_buf_fmt : SPRINTF \'(\' expr \',\' rawstring_parm': v => {
      const e = X(v[2]);
      if (e.typ !== strings) yyerror("Leftmost sprintf parameter must be of type 'string'");
      emit_push_addr(e); varargs_cnt = 0;
      return X(v[4]).adr;
    },
    'sprintf_parmlist : expr': v => { sprintfParm(X(v[0])); },
    'sprintf_parmlist : sprintf_parmlist \',\' expr': v => { sprintfParm(X(v[2])); },
    'selection_stmt : if_expr then_stmt': v => { code[v[0]].y = v[1]; },
    'selection_stmt : if_expr then_stmt the_else stmt': v => { code[v[0]].y = v[2]; code[v[1]].y = lc; },
    'selection_stmt : switch_hdr \'{\' case_groups opt_default \'}\'': v => {
      const i = case_loc[curr_case];
      code[i].y = v[3];
      code[i - 1].f = OP.TEST_EQ;
      curr_case = switch_block[switch_level].first_case - 1;
      switch_level--;
      process_breaks();
      leave_break_block();
    },
    'if_expr : IF \'(\' expr \')\'': v => { gen_exprval(v[2]); const r = lc; emit(OP.JZER); return r; },
    'then_stmt : stmt': () => lc,
    'the_else : ELSE': () => { emit(OP.JUMP); return lc; },
    'switch_hdr : SWITCH \'(\' expr \')\'': v => {
      enter_break_block('switch');
      ++curr_case;
      gen_exprval(v[2]);
      switch_level++;
      switch_block[switch_level] = { first_case: curr_case, expr_index: X(v[2]) };
    },
    'case_hdr_list : case_hdr': () => { first_case_hdr = curr_case; case_hdr_cnt = 1; },
    'case_hdr_list : case_hdr_list case_hdr': () => { case_hdr_cnt++; },
    'case_hdr : CASE begin_case expr \':\'': v => {
      const sw = switch_block[switch_level].expr_index, e = X(v[2]);
      if (sw.typ !== e.typ && e.typ !== notyp) yyerror('Case expression type differs from type of switch expression');
      else {
        gen_exprval(e);
        emit(OP.TEST_EQ_KEEP);
        case_loc[++curr_case] = lc;
        emit(OP.JZER);
      }
    },
    'begin_case : ': () => {
      const j = switch_block[switch_level].first_case;
      if (case_hdr_cnt > 0) emit(OP.JUMP);
      if (curr_case > j) code[case_loc[curr_case]].y = lc;
    },
    'patch_case_hdrs : ': () => {
      for (let i = 1, j = first_case_hdr; i < case_hdr_cnt; i++, j++) code[case_loc[j] + 1].y = lc;
      case_hdr_cnt = 0; first_case_hdr = -1;
    },
    'opt_default : ': () => lc,
    'opt_default : the_default stmt_list': v => v[0],
    'the_default : DEFAULT \':\'': () => lc,
    'cobegin_stmt : cbegin \'{\' stmt_list \'}\'': () => { if (level === 1) emit(OP.COEND); in_cobegin = 0; },
    'iteration_stmt : the_while while_expr stmt': v => { emit1(OP.JUMP, v[0]); code[v[1]].y = lc; return v[0]; },
    'iteration_stmt : the_do do_stmt_loc stmt the_do_while do_while_expr \';\'': v => { code[v[4]].y = v[1]; return v[3]; },
    'iteration_stmt : for_init opt_continue_expr for_semic2 opt_iter_exprs \')\' stmt': v => {
      const fi = for_info[curr_for]; let r;
      if (v[3]) {
        r = fi.iter_loc;
        emit1(OP.JUMP, fi.iter_loc);
        if (v[1]) code[fi.stmt_loc - 1].y = fi.cont_loc;
      } else {
        r = fi.stmt_loc;
        if (v[1]) emit1(OP.JUMP, fi.cont_loc); else emit1(OP.JUMP, fi.stmt_loc);
      }
      if (v[1]) code[fi.cont_jzer].y = lc;
      code[fi.iter_loc - 1].y = fi.stmt_loc;
      curr_for--;
      return r;
    },
    'the_while : WHILE': () => { const r = lc; enter_break_block('loop'); return r; },
    'while_expr : \'(\' expr \')\'': v => { gen_exprval(v[1]); const r = lc; emit(OP.JZER); return r; },
    'the_do : DO': () => { enter_break_block('loop'); },
    'do_stmt_loc : ': () => lc,
    'the_do_while : WHILE': () => lc,
    'do_while_expr : \'(\' expr \')\'': v => { gen_exprval(v[1]); emit1(OP.JZER, lc + 2); const r = lc; emit(OP.JUMP); return r; },
    'for_init : the_for opt_for_expr_list \';\'': () => { for_info[curr_for].cont_loc = lc; },
    'the_for : FOR \'(\'': () => { enter_break_block('loop'); for_info[++curr_for] = { iter_loc: -1, cont_loc: -1, cont_jzer: -1, stmt_loc: -1 }; },
    'opt_continue_expr : ': () => 0,
    'opt_continue_expr : expr': v => { gen_exprval(v[0]); for_info[curr_for].cont_jzer = lc; emit(OP.JZER); return 1; },
    'for_semic2 : \';\'': () => { emit(OP.JUMP); for_info[curr_for].iter_loc = lc; },
    'opt_iter_exprs : ': () => { for_info[curr_for].stmt_loc = lc; return 0; },
    'opt_iter_exprs : for_expr_list': () => { if (for_info[curr_for].cont_jzer >= 0) emit(OP.JUMP); for_info[curr_for].stmt_loc = lc; return 1; },
    'cbegin : CBEGIN': () => {
      if (level !== 1) yyerror("'cobegin' block allowed only in 'main'");
      else if (in_cobegin) yyerror("'cobegin' blocks cannot be nested");
      else emit(OP.COBEGIN);
      in_cobegin = 1;
    },
    'continue_stmt : CONTINUE \';\'': () => {
      if (break_level < 0 || break_block[break_level].bb_type !== 'loop') yyerror("'continue' is inappropriate outside a loop");
      else { cont_loc[++curr_cont] = lc; if (break_block[break_level].first_cont < 0) break_block[break_level].first_cont = curr_cont; emit(OP.JUMP); }
    },
    'break_stmt : BREAK \';\'': () => {
      if (break_level < 0) yyerror("'break' is inappropriate outside a 'loop' or 'switch' statement");
      else { break_loc[++curr_break] = lc; if (break_block[break_level].first_break < 0) break_block[break_level].first_break = curr_break; emit(OP.JUMP); }
    },
    'return_stmt : the_return opt_expr \';\'': v => {
      const e = v[1];
      if (void_function) { if (e === NO_EXPR) emit(OP.EXIT_PROC); else yyerror("Cannot return a value from a 'void' function"); }
      if (e !== NO_EXPR) gen_exprval(e); else emit1(OP.PUSH_LIT, 0);
      emit(OP.STORE);
      return_loc[++curr_ret] = lc;
      emit(OP.JUMP);
    },
    'the_return : RETURN': () => {
      if (!in_func_decl) yyerror("'return' is inappropriate outside a function");
      else if (!void_function) emit2(OP.LOAD_ADDR, tab[func_tab].lev + 1, 0);
    },
    'output_item : expr': v => {
      const e = X(v[0]);
      if (e.typ === arrays) yyerror('Cannot output an array');
      else if (e.typ === strings) { if (!e.arelt) emit_push_addr(e); emit(OP.WRITE_STRING); }
      else { gen_exprval(e); emit1(OP.WRITE, e.typ); }
    },
    'output_item : ENDL': () => { emit(OP.WRITELN); },
    'output_item : RAWSTRING': () => { emit1(OP.WRITE_RAWSTRING, store_string(laststring)); },
    'input_stmt : CIN GTGT expr \';\'': v => {
      const e = X(v[2]);
      if (e.obj !== variable) yyerror("input item must be a 'variable'");
      else if (e.typ !== ints && e.typ !== chars && e.typ !== notyp) yyerror("input item must be of type 'int' or 'char'");
      else { if (!e.arelt) emit_push_addr(e); emit1(OP.READ, e.typ); }
    },
    "input_stmt : NBCIN GTGT expr ';'": v => {
      const e = X(v[2]);
      if (e.obj !== variable) yyerror("input item must be a 'variable'");
      else if (e.typ !== ints && e.typ !== chars && e.typ !== notyp) yyerror("input item must be of type 'int' or 'char'");
      else { if (!e.arelt) emit_push_addr(e); emit2(OP.READ, 1, e.typ); }
    },
    'opt_expr : ': () => NO_EXPR,
    'var_assign : id_becomes expr': v => {
      const t = tab[v[0]], e = X(v[1]);
      gen_exprval(e);
      if (t.typ === e.typ) {
        if (t.typ === sems || t.typ === bsems || t.typ === conds) yyerror("Cannot assign to 'semaphore' or 'condition'");
        else if (t.typ === arrays) emit1(OP.COPY_BLOCK, atab[t.ref] ? atab[t.ref].size : 0);
        else if (assign_cnt > 1) emit(OP.STORE_KEEP); else emit(OP.STORE);
      } else yyerror('Type mismatch in assignment');
      assign_cnt--;
      return v[1];
    },
    'var_assign : array_var_becomes expr': v => {
      const a = X(v[0]), e = X(v[1]);
      gen_exprval(e);
      if (a.typ === e.typ) {
        if (a.typ === sems || a.typ === bsems || a.typ === conds) yyerror("Cannot assign to 'semaphore' or 'condition'");
        else if (a.typ === arrays) emit1(OP.COPY_BLOCK, atab[a.aref] ? atab[a.aref].size : 0);
        else if (assign_cnt > 1) emit(OP.STORE_KEEP); else emit(OP.STORE);
      } else yyerror('Type mismatch in assignment');
      assign_cnt--;
      return v[0];   // bacc de jBACI devuelve el elemento del arreglo (en x = a[i] = v vuelve a leerlo)
    },
    'id_becomes : ident \'=\'': v => {
      assign_cnt++;
      const t = tab[v[0]];
      if (t.obj === variable) {
        if (t.typ === sems || t.typ === bsems) yyerror("Must use `initialsem' to initialize a 'semaphore'");
        else emit_push_addr(t);
      } else yyerror("'variable' identifier expected");
    },
    'array_var_becomes : array_var \'=\'': () => { assign_cnt++; },
    'cond_expr : left_simp_expr relational_op simple_expr': v => {
      const a = X(v[0]), b = X(v[2]);
      gen_exprval(b);
      if (a.typ === b.typ) { if (a.typ === ints || a.typ === chars) emit(v[1]); else yyerror("Only 'int' and 'char' types can be compared"); }
      else yyerror('Types in comparison are unequal');
      a.typ = ints;
    },
    'relational_op : EQ': () => OP.TEST_EQ, 'relational_op : \'<\'': () => OP.TEST_LT, 'relational_op : \'>\'': () => OP.TEST_GT,
    'relational_op : LE': () => OP.TEST_LE, 'relational_op : GE': () => OP.TEST_GE, 'relational_op : NE': () => OP.TEST_NE,
    'simple_expr : \'+\' term': v => { const e = X(v[1]); gen_exprval(e); if (e.typ !== ints && e.typ !== notyp) { yyerror("'int' type expected"); e.typ = notyp; } return v[1]; },
    'simple_expr : \'-\' term': v => { const e = X(v[1]); gen_exprval(e); if (e.typ !== ints && e.typ !== notyp) { yyerror("type 'int' expected"); e.typ = notyp; } else emit(OP.NEGATE); return v[1]; },
    'simple_expr : left_simp_expr add_op term': v => {
      const a = X(v[0]), b = X(v[2]);
      gen_exprval(b);
      if (v[1] === OP.DO_OR) {
        if (a.typ === ints && b.typ === ints) emit(OP.DO_OR);
        else if (a.typ !== notyp && b.typ !== notyp) { yyerror("type 'int' expected"); a.typ = notyp; }
      } else { a.typ = resulttype(a.typ, b.typ); if (a.typ === ints) emit(v[1]); }
    },
    'left_simp_expr : simple_expr': v => { gen_exprval(v[0]); },
    'add_op : \'+\'': () => OP.DO_ADD, 'add_op : \'-\'': () => OP.DO_SUB, 'add_op : OR': () => OP.DO_OR,
    'term : left_term mult_op factor': v => {
      const a = X(v[0]), b = X(v[2]);
      gen_exprval(b);
      if (a.typ === ints && b.typ === ints) emit(v[1]);
      else if (a.typ !== notyp && b.typ !== notyp) { yyerror(v[1] === OP.DO_AND ? "'int' type expected" : "type 'int' expected"); a.typ = notyp; }
    },
    'left_term : term': v => { gen_exprval(v[0]); },
    'mult_op : \'*\'': () => OP.DO_MUL, 'mult_op : \'/\'': () => OP.DO_DIV, 'mult_op : \'%\'': () => OP.DO_MOD, 'mult_op : AND': () => OP.DO_AND,
    'factor : unsigned_num': v => { const e = new_expr(); e.obj = constant; e.adr = v[0]; e.typ = ints; e.lev = level; return e; },
    'factor : CHARCON': () => { const e = new_expr(); e.obj = constant; e.adr = laststring.charCodeAt(0) || 0; e.typ = chars; e.lev = level; return e; },
    'factor : \'(\' expr \')\'': v => v[1],
    'factor : \'!\' factor': v => { const e = X(v[1]); gen_exprval(e); if (e.typ === ints) emit(OP.COMPLEMENT); else if (e.typ !== notyp) { yyerror("type 'int' expected"); e.typ = notyp; } return v[1]; },
    'variable : var_ident PLPL': v => incdec(v[0], OP.DO_ADD),
    'variable : PLPL var_ident': v => incdec(v[1], OP.DO_ADD),
    'variable : var_ident MIMI': v => incdec(v[0], OP.DO_SUB),
    'variable : MIMI var_ident': v => incdec(v[1], OP.DO_SUB),
    'var_ident : ident': v => exprFromTab(v[0]),
    'func_call : func_id actual_params': v => {
      const t = tab[v[0]];
      const e = exprFromTab(v[0]);
      if (t.lev === -1) stdproc_pcode(v[0], parmct);
      else if (t.obj === func || t.obj === procedure || t.obj === ext_function || t.obj === ext_procedure) {
        e.ref = 0;
        const k1 = btab[t.ref].lastpar - v[0];
        if (k1 > parmct && first_parmcterr) { yyerror(`Too few actual parameters in the ${t.name} call`); first_parmcterr = 0; }
        const k = btab[t.ref].psize - 1;
        emit2(OP.CALL, t.mon === 0 ? 0 : -1, k);
        if (t.lev < level) emit2(OP.UPDATE_DISPLAY, t.lev, level);
        else if (t.mon && level === t.lev) emit2(OP.UPDATE_DISPLAY, level - 1, level);
      }
      toppfs--;
      if (toppfs < 0) parmct = last_pf = 0; else { parmct = pfstack[toppfs].pct; last_pf = pfstack[toppfs].tix; }
      return e;
    },
    'func_id : ident': v => {
      last_pf = v[0];
      const t = tab[v[0]];
      if (t.obj !== func && t.obj !== procedure && t.obj !== ext_function && t.obj !== ext_procedure) yyerror("'function call' expected");
      else {
        pfstack[++toppfs] = { tix: last_pf, pct: 0 }; parmct = 0;
        first_stringerr = first_parmcterr = 1;
        if (t.lev !== -1) {
          if (t.mon && tab[prt].mon && t.mon !== tab[prt].mon) yyerror('Cross monitor calls not allowed');
          emit1(OP.MARKSTACK, last_pf - last_predeclared);
        }
      }
      return v[0];
    },
    'actual_param : expr': v => {
      if (toppfs < 0) return;
      parmct = ++pfstack[toppfs].pct;
      const e = X(v[0]);
      if (tab[last_pf].lev === -1) stdproc_parm(last_pf, e, parmct); else proc_parm(last_pf, e, parmct);
    },
    'actual_param : ident \'=\'': v => {
      if (toppfs < 0) return;
      parmct = ++pfstack[toppfs].pct;
      const e = exprFromTab(v[0]); e.eqmark = 1;
      if (tab[last_pf].lev === -1) stdproc_parm(last_pf, e, parmct); else yyerror('syntax error');
    },
    'stringconcat_call : STRINGCONCAT left_exprparm right_stringparm': v => {
      if (X(v[1]).typ !== strings) yyerror("left parameter is not of type 'string'");
      if (X(v[2]).typ === rawstrings) emit1(OP.CONCAT_RAWSTRING, X(v[2]).adr); else emit(OP.CONCAT_STRING);
      return NO_EXPR;
    },
    'right_stringparm : \',\' expr \')\'': v => {
      const e = X(v[1]);
      if (e.typ !== strings) { yyerror("right parameter is not of type 'string'"); last_eltyp = notyp; }
      else if (!e.arelt) emit_push_addr(e);
      return v[1];
    },
    'right_stringparm : \',\' rawstring_parm \')\'': v => v[1],
    'rawstring_parm : RAWSTRING': () => rawExpr(),
    'stringcopy_call : STRINGCOPY left_exprparm right_stringparm': v => {
      if (X(v[1]).typ !== strings) yyerror("left parameter is not of type 'string'");
      if (X(v[2]).typ === rawstrings) emit1(OP.COPY_RAWSTRING, X(v[2]).adr); else emit(OP.COPY_STRING);
      return NO_EXPR;
    },
    'stringcompare_call : STRINGCOMPARE left_exprparm right_stringparm': v => {
      if (X(v[1]).typ !== strings) yyerror("left parameter is not of type 'string'");
      const r = funcResult();
      if (X(v[2]).typ === rawstrings) emit1(OP.COMPARE_RAWSTRING, X(v[2]).adr); else emit(OP.COMPARE_STRING);
      return r;
    },
    'stringlength_call : STRINGLENGTH single_exprparm': v => {
      const r = funcResult(), e = X(v[1]);
      if (e.typ === rawstrings) emit1(OP.PUSH_LIT, e.ref - 1); else emit(OP.LENGTH_STRING);
      return r;
    },
    'single_exprparm : \'(\' expr \')\'': v => stringParmToStack(X(v[1])),
    'single_exprparm : \'(\' RAWSTRING \')\'': () => rawExpr(),
    'sscanf_call : sscanf_buf_fmt \',\' sscanf_parmlist \')\'': v => { const r = funcResult(); emit1(OP.PUSH_LIT, varargs_cnt); emit1(OP.SSCANF_OP, v[0]); return r; },
    'sscanf_buf_fmt : SSCANF \'(\' expr \',\' rawstring_parm': v => {
      const e = X(v[2]);
      if (e.typ !== strings) yyerror("Leftmost sscanf parameter must be of type 'string'");
      emit_push_addr(e); varargs_cnt = 0;
      return X(v[4]).adr;
    },
    'sscanf_parmlist : expr': v => { sscanfParm(X(v[0])); },
    'sscanf_parmlist : sscanf_parmlist \',\' expr': v => { sscanfParm(X(v[2])); },
    'receive_call : RECEIVE left_exprparm \')\'': v => { if (X(v[1]).typ !== strings) yyerror("Left parameter must be of type 'string'"); emit(OP.RECEIVE_OP); return funcResult(); },
    'receive_call : RECEIVE left_exprparm \',\' expr \')\'': v => {
      if (X(v[1]).typ !== strings) yyerror("Left parameter must be of type 'string'");
      const e = X(v[3]);
      if (e.obj !== variable) yyerror("the right 'receive' parameter must be a variable");
      else if (e.typ !== ints) yyerror("the right 'receive' parameter must be of type 'int'");
      else { if (!e.arelt) emit_push_addr(e); emit(OP.RECEIVE_ID); }
      return funcResult();
    },
    'array_var : array_id index_expr': v => {
      const e = X(v[0]);
      e.aref = e.ref;
      e.ref = SIZEOF_INT * (atab[last_aref] ? atab[last_aref].elsize : 0);
      e.arelt = 1; e.typ = last_eltyp;
      topars--;
      if (topars >= 0) { last_aref = arstack[topars].aref; last_eltyp = arstack[topars].eltyp; }
      return e;
    },
    'array_id : ident': v => {
      const t = tab[v[0]];
      if (t.typ !== arrays) { yyerror(`'${t.name}' is not of type 'array'`); last_aref = 0; last_eltyp = notyp; }
      else { last_aref = t.ref; last_eltyp = atab[last_aref].eltyp; emit_push_addr(t); }
      arstack[++topars] = { aref: last_aref, eltyp: last_eltyp };
      const e = new_expr();
      e.obj = t.obj; e.typ = t.typ; e.adr = t.adr; e.ref = t.ref; e.lev = t.lev; e.normal = t.normal;
      return e;
    },
    'index_expr : index_expr \'[\' expr \']\'': v => indexStep(X(v[2])),
    'index_expr : \'[\' expr \']\'': v => indexStep(X(v[1])),
    'typecast : INT \'(\' expr \')\'': v => { X(v[2]).typ = ints; return v[2]; },
    'typecast : CHAR \'(\' expr \')\'': v => { X(v[2]).typ = chars; return v[2]; },
    'ident : IDENTIFIER': v => loc(v[0], level),
    'newident : IDENTIFIER': v => { lindaReserved(v[0]); return enter(v[0], constant, level, level); },
  };
  // en el bacc de jBACI las operaciones de Linda son palabras reservadas
  function lindaReserved(name) {
    if (/^(postnote|readnote|removenote|readnoteeq|removenoteeq)$/.test(name)) {
      lasttoken = name; yyerror('syntax error');
      const f = infile[Math.max(0, curr_infile)];
      throw new PcodeError('syntax error', f.line_no, f.fname);
    }
  }
  function sprintfParm(e) {
    if (e.typ !== ints && e.typ !== strings) yyerror("sprintf parameter must be either of type 'int' or type 'string'");
    if (e.typ === strings) emit_push_addr(e); else gen_exprval(e);
    varargs_cnt++;
  }
  function sscanfParm(e) {
    if (e.typ !== ints && e.typ !== strings) yyerror("sscanf parameter must be either of type 'int' or type 'string'");
    emit_push_addr(e);
    varargs_cnt++;
  }
  function incdec(e, op) {
    e = X(e);
    if (e.typ !== ints && e.typ !== chars) yyerror("'int' or 'char' expected");
    else { emit_push_addr(e); gen_loadvar(e); emit1(OP.PUSH_LIT, 1); emit(op); emit(OP.STORE); }
    return e;
  }
  function indexStep(e) {
    gen_exprval(e);
    const st = { aref: arstack[topars].aref, eltyp: arstack[topars].eltyp };
    index_expr(e, st);
    last_aref = st.aref; last_eltyp = st.eltyp;
    arstack[topars].aref = last_aref; arstack[topars].eltyp = last_eltyp;
  }

  /* ----- inicialización (baccutil.c: global_init) ----- */
  curr_infile = open_infile(mainName, mainSrc);
  btab[0] = { last: 0, lastpar: 0, psize: 0, vsize: 0 };
  display[0] = 0;
  enterstid('          ', variable, notyp, 0);
  enterstid('INT_MSG', constant, ints, 1);
  enterstid('STRING_MSG', constant, ints, 2);
  enterstid('char', type, chars, SIZEOF_INT); char_loc = last_tab;
  enterstid('int', type, ints, SIZEOF_INT); int_loc = last_tab;
  enterstid('condition', type, conds, SIZEOF_INT);
  enterstid('semaphore', type, sems, SIZEOF_INT);
  enterstid('binarysem', type, bsems, SIZEOF_INT);
  enterstid('empty', func, ints, SF_EMPTY);
  enterstid('initialsem', procedure, notyp, SP_INITSEM);
  enterstid('p', procedure, notyp, SP_PWAIT);
  enterstid('wait', procedure, notyp, SP_PWAIT);
  enterstid('v', procedure, notyp, SP_VSIGNAL);
  enterstid('signal', procedure, notyp, SP_VSIGNAL);
  enterstid('waitc', procedure, notyp, SP_WAITC);
  enterstid('signalc', procedure, notyp, SP_SIGNALC);
  enterstid('exit', procedure, notyp, SP_EXIT);
  enterstid('suspend', procedure, notyp, SP_SUSPEND);
  enterstid('revive', procedure, notyp, SP_REVIVE);
  enterstid('which_proc', func, ints, SF_WHICHPROC);
  enterstid('random', func, ints, SF_RANDOM);
  enterstid('postnote', procedure, notyp, SP_POST);
  enterstid('readnote', procedure, notyp, SP_READNOTE);
  enterstid('removenote', procedure, notyp, SP_REMOVENOTE);
  enterstid('readnoteeq', procedure, notyp, SP_READNOTEEQ);
  enterstid('removenoteeq', procedure, notyp, SP_REMOVENOTEEQ);
  enterstid('create', procedure, notyp, SP_CREATE);
  enterstid('changecolor', procedure, notyp, SP_CHANGECOLOR);
  enterstid('makevisible', procedure, notyp, SP_MAKEVISIBLE);
  enterstid('moveto', procedure, notyp, SP_MOVETO);
  enterstid('moveby', procedure, notyp, SP_MOVEBY);
  last_predeclared = last_tab;

  /* ----- analizador LALR(1) con el comportamiento de yacc ----- */
  const { syms, rules, states } = TABLAS;
  const symIdx = new Map(syms.map((s, i) => [s, i]));
  const ruleAction = rules.map(r => A[`${r[0]} : ${r[2]}`] || null);
  const ACT = states.map(s => { const m = new Map(); for (let i = 0; i < s[0].length; i += 2) m.set(s[0][i], s[0][i + 1]); return m; });
  const GOTO = states.map(s => { const m = new Map(); for (let i = 0; i < s[1].length; i += 2) m.set(s[1][i], s[1][i + 1]); return m; });
  const sst = [0], vst = [null];
  let la = null;
  let fatal = null;
  try {
    for (;;) {
      const st = sst[sst.length - 1];
      let act;
      if (states[st][3]) act = -states[st][2];
      else {
        if (la === null) { la = yylex(); la.k = symIdx.has(la.t) ? symIdx.get(la.t) : -1; }
        act = ACT[st].get(la.k);
        if (act === undefined) {
          if (states[st][2] >= 0) act = -states[st][2];
          else { yyerror('syntax error'); const f = infile[Math.max(0, curr_infile)]; throw new PcodeError('syntax error', f.line_no, f.fname); }
        }
      }
      if (act === -100000) break;
      if (act >= 0) { if (la.t === '$end') break; sst.push(act); vst.push(la.v); la = null; continue; }
      const r = -act, n = rules[r][1];
      const vals = vst.slice(vst.length - n);
      let val = n ? vals[0] : undefined;
      const fn = ruleAction[r];
      if (fn) { const out = fn(vals); if (out !== undefined) val = out; }
      sst.length -= n; vst.length -= n;
      const g = GOTO[sst[sst.length - 1]].get(symIdx.get(rules[r][0]));
      sst.push(g); vst.push(val);
    }
  } catch (e) {
    if (!(e instanceof PcodeError)) throw e;
    fatal = e;
  }
  if (errcount > 0 || fatal) {
    const m = tab[btab[0].lastpar];
    if (m && code[m.adr]) code[m.adr].f = OP.HALT;
  }
  lst.push(errcount > 0 ? (errcount === 1 ? 'Because of 1 error the PCODE file will not execute\n' : `Because of ${errcount} errors, the PCODE file will not execute\n`) : '');

  const ids = [];
  for (let i = last_predeclared + 1; i <= last_tab; i++) {
    const t = tab[i];
    ids.push({ index: i - last_predeclared, name: t.name, link: t.link > 0 ? t.link - last_predeclared : 0, obj: t.obj, typ: t.typ, ref: t.ref, normal: t.normal, lev: t.lev, adr: t.adr, mon: t.mon, atomic: t.atomic });
  }
  const blocks = btab.slice(0, last_btab + 1).map(b => ({
    last: b.last > last_predeclared ? b.last - last_predeclared : b.last,
    lastpar: b.lastpar > last_predeclared ? b.lastpar - last_predeclared : b.lastpar,
    psize: b.psize, vsize: b.vsize,
  }));
  const arrays_ = atab.slice(0, last_atab + 1).map(a => ({ ...a }));
  const res = {
    ok: errcount === 0 && !fatal,
    errors: errors.concat(fatal && !errors.some(x => x.msg === fatal.message) ? [{ msg: fatal.message, line: fatal.line, file: fatal.file, fix: 0 }] : []),
    code: code.slice(0, lc), ids, blocks, arrays: arrays_, stab, dbg,
    files: infile.map(f => ({ name: f.fname, parent: f.parent })),
    lst: lst.join(''),
  };
  res.pco = () => writePco(res, mainName);
  return res;
}

/* .pco con el mismo formato que bacc (writetab.c de la versión de jBACI) */
function writePco(r, mainName, when) {
  const p = (v, n) => String(v).padStart(n);
  const L = [COMP_NAME, `Source file: ${mainName}  ${when || ''}`.trimEnd()];
  L.push(`0  ${r.code.length - 1}                 PCODE table`, ' lc   f    x    y');
  r.code.forEach((c, i) => L.push(`${p(i, 3)} ${p(c.f, 3)} ${p(c.x, 4)} ${p(c.y, 4)}`));
  L.push(`1  ${r.ids.length}            IDENTIFIER table`, 'index   identifier    link  obj  type  ref normal   lev   adr   mon atomic');
  r.ids.forEach(t => L.push(`${p(t.index, 4)}  ${t.name.padEnd(12)}  ${[t.link, t.obj, t.typ, t.ref, t.normal, t.lev, t.adr, t.mon, t.atomic].map(x => p(x, 5)).join(' ')}`));
  L.push(`0  ${r.blocks.length - 1}         BLOCK table`, 'index last lastpar psize vsize');
  r.blocks.forEach((b, i) => L.push(`${p(i, 4)} ${p(b.last, 4)} ${p(b.lastpar, 7)} ${p(b.psize, 4)} ${p(b.vsize, 4)}`));
  L.push(`0  ${r.arrays.length - 1}           ARRAY table`, 'index inxtype eltyp elref  low  high  elsize  size');
  r.arrays.forEach((a, i) => L.push(` ${p(i, 3)}   ${p(a.inxtyp, 3)}   ${p(a.eltyp, 3)}  ${[a.elref, a.low, a.high, a.elsize, a.size].map(x => p(x, 5)).join(' ')}`));
  L.push(`0 ${p(r.stab.length, 3)} ${p(60, 3)}                  STRING table`);
  for (let s = 0; s < r.stab.length; s += 60) L.push(r.stab.slice(s, s + 60));
  L.push(`0  ${r.files.length - 1}           Input File array`, 'index parent      file name');
  r.files.forEach((f, i) => L.push(` ${p(i, 3)}   ${p(f.parent, 3)}   ${f.name}`));
  L.push(`0  ${r.dbg.length - 1}           PCODE debugging information`, '   lc findex flineno');
  r.dbg.forEach(d => L.push(` ${p(d.lc, 3)}   ${p(d.fix, 3)}   ${p(d.flno, 3)}`));
  return L.join('\n') + '\n';
}

const api = { compile, writePco, OP, OPNAME, PcodeError, LINDA_NONE };
if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign(api, { _root: root });
root.BACI_PCODE = api;
})(typeof window !== 'undefined' ? window : globalThis);

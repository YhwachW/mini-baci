/*
 * Mini BACI: máquina virtual que ejecuta el PCODE de bacc, como el intérprete de BACI/jBACI.
 *
 * Es una traducción del intérprete original (bainterp.c y baiutils.c de BACI): una sola pila
 * repartida entre los procesos, la tabla de procesos, el planificador que elige al azar
 * (chooseproc) con cuantos de 0 a 4 instrucciones, y los monitores con su semáforo, la cola
 * de entrada y las colas de las condition. Expone la misma interfaz que la máquina de
 * baci.js (procs, sems, monitors, globals, out, step...) para que la app la muestre igual.
 */
(function (root) {
'use strict';

const P = root.BACI_PCODE || (typeof require !== 'undefined' ? require('./pcode.js') : null);
const OP = P.OP;
const LF = 100000;
const STMAX = 6000, STKINCR = 200, PMAX = 18, PMAXP1 = 19, STEPMAXP1 = 5, MAXPRIO = 0x7fff, LMAX = 7;
const FLAG_INT = -32767, FLAG_CHAR = 13;
// OBJTYPE y TYPES
const constant = 0, variable = 1, monitorObj = 5, mainproc = 6;
const ints = 1, bools = 2, chars = 3, bsems = 4, sems = 5, conds = 6, arrays = 7, strings = 11;

const HALT_MSG = {
  divchk: 'división por cero', inxchk: 'índice de arreglo fuera del rango declarado',
  stkchk: 'dirección de pila inválida (¿recursión sin fin o demasiadas variables?)', charchk: 'carácter que no se puede mostrar',
  inpchk: 'el dato ingresado no es un número', pcodchk: 'instrucción PCODE inválida', semchk: 'un semáforo no puede empezar con un valor negativo',
  bsemchk: 'un binarysem quedó en un valor distinto de 0 o 1', xmonchk: 'llamada entre monitores distintos', procchk: 'número de proceso inválido en revive',
  padrchk: 'dirección de código inválida', wrtchk: 'no se puede mostrar este tipo de variable', rdchk: 'no se puede leer este tipo de variable',
};

class VMHalt extends Error { constructor(code, msg) { super(msg || HALT_MSG[code] || code); this.code = code; } }

class PMachine {
  /* res: resultado de BACI_PCODE.compile. prog: el programa de baci.js (para prog.uses y prog.files). */
  constructor(res, prog, rnd) {
    this.res = res;
    this.prog = prog || { uses: {}, files: res.files.map(f => f.name) };
    this.rnd = rnd || Math.random;
    this.code = res.code;
    this.tab = [null].concat(res.ids.map(t => ({ ...t })));
    this.btab = res.blocks;
    this.atab = res.arrays;
    this.stab = res.stab;
    this.s = new Int32Array(STMAX);
    this.bytes = new Uint8Array(this.s.buffer);
    // línea de cada instrucción a partir de la información de depuración de bacc
    this.pcLine = new Array(this.code.length).fill(0);
    let cur = 0, di = 0;
    const dbg = res.dbg;
    for (let pc = 0; pc < this.code.length; pc++) {
      while (di < dbg.length && dbg[di].lc <= pc) {
        const d = dbg[di++];
        if (d.flno > 0) cur = d.fix * LF + d.flno;
      }
      this.pcLine[pc] = cur;
    }
    this.out = []; this.outBase = 0;
    this.board = []; this.noteSeq = 0;
    this.gfx = new Map(); this.gfxVer = 0;
    this.inBuf = ''; this.waitingInput = null;
    this.steps = 0; this.status = 'ready'; this.error = null;
    this.semInit = new Map();
    this.isPcode = true;
    this._dirty = true;
  }
  fmtLine(l) {
    if (!l) return '';
    const f = Math.floor(l / LF), n = l % LF;
    return f === 0 ? `línea ${n}` : `línea ${n} de ${this.res.files[f] ? this.res.files[f].name : '?'}`;
  }
  /* ---------------------------------------------------------- arranque */
  boot() {
    const s = this.s, tab = this.tab, btab = this.btab;
    this.ptab = [];
    for (let i = 0; i <= PMAX; i++) this.ptab.push({ pid: i, pc: 0, t: 0, b: 0, tabix: -1, stacksize: 0, display: new Array(LMAX + 1).fill(0), suspend: -1, active: -1, monitor: 0, priority: 0, atomic: 0, xpc: 0, name: '', done: false, waitKind: null, signaled: false, linda: null });
    const p0 = this.ptab[0];
    const mainTix = btab[0].lastpar;
    if (!mainTix || !tab[mainTix] || tab[mainTix].obj !== mainproc) throw new VMHalt('pcodchk', 'el programa no tiene main()');
    const main_b = btab[0].vsize;
    p0.b = main_b;
    s[main_b + 3] = -1;
    s[main_b + 4] = mainTix;
    p0.tabix = mainTix;
    p0.display[0] = 0; p0.display[1] = main_b;
    p0.t = btab[0].vsize + btab[tab[mainTix].ref].vsize - 1;
    p0.pc = tab[mainTix].adr;
    p0.active = 1;
    p0.stacksize = STMAX - PMAX * STKINCR;
    p0.name = 'main';
    for (let i = 1; i <= PMAX; i++) {
      const p = this.ptab[i];
      p.b = this.ptab[i - 1].stacksize + 1;
      p.stacksize = p.b + STKINCR - 1;
      p.t = p.b - 1;
    }
    this.initProcDisplays();
    this.npr = 0; this.curpr = 0; this.pflag = 0; this.stepcount = 0; this.shortcall = 0;
    this.lastPid = -1;
    this.status = 'ready';
    // direcciones de los semáforos globales y de main, para mostrar su valor inicial
    this.semAddrs = new Set(this.semList().map(x => x.addr));
    this._dirty = true;
  }
  initProcDisplays() {
    const main_b = this.btab[0].vsize;
    for (let i = 1; i <= PMAX; i++) {
      const d = this.ptab[i].display;
      d[0] = 0; d[1] = main_b; for (let j = 2; j <= LMAX; j++) d[j] = 0;
    }
  }
  rand(n) { return Math.floor(this.rnd() * n); }
  sa(addr) {   // saddr_check
    const p = this.ptab[this.curpr];
    if (addr >= p.stacksize || addr < 0) throw new VMHalt('stkchk');
    return addr;
  }
  pa(addr) { if (addr < 0 || addr >= this.code.length) throw new VMHalt('padrchk'); return addr; }
  /* --------------------------------------------------- planificador */
  chooseproc(forced) {
    const ptab = this.ptab;
    const runnable = p => p.active > 0 && p.suspend < 0 && p.tabix >= 0 && !p.linda;
    if (forced && runnable(forced) && !(ptab[this.curpr].atomic && runnable(ptab[this.curpr]) && ptab[this.curpr] !== forced)) {
      this.curpr = forced.pid; this.stepcount = 0; return true;
    }
    let d = PMAXP1, look = this.rand(PMAXP1);
    const add = 1 + this.rand(PMAX);
    while (!runnable(ptab[look]) && d >= 0) { d--; look = (look + add) % PMAXP1; }
    if (d < 0) return false;
    this.stepcount = this.rand(STEPMAXP1);
    const cp = ptab[this.curpr];
    if (cp.atomic && cp.active > 0 && !cp.done) { if (cp.suspend >= 0) return false; }
    else this.curpr = look;
    return true;
  }
  /* --------------------------------------------- un paso de PCODE */
  step(forcedUi) {
    if (this.status === 'input') return false;
    if (this.status !== 'ready' && this.status !== 'running') return false;
    this.status = 'running';
    this._dirty = true;
    const forced = forcedUi ? this.ptab[forcedUi.pid] : null;
    try {
      const ptab = this.ptab;
      if (ptab[0].active > 0) this.curpr = 0;
      else if (this.stepcount === 0 || (forced && forced.pid !== this.curpr)) {
        if (!this.chooseproc(forced)) {
          if (this.allDone()) { this.status = 'done'; return false; }
          this.status = 'deadlock'; return false;
        }
      } else this.stepcount--;
      const pr = ptab[this.curpr];
      const pc = pr.pc;
      const ir = this.code[pc];
      if (!ir) throw new VMHalt('padrchk');
      pr.pc++;
      if (this.stepcount === 0) {
        const nx = this.code[pr.pc];
        if (nx && (nx.f === OP.EXIT_PROC || nx.f === OP.EXIT_FCN)) this.stepcount = 1;
      }
      if (this.pflag) {
        if (ir.f === OP.MARKSTACK) this.npr++;
        this.curpr = this.npr;
      }
      this.lastPid = this.curpr;
      this.lastPc = pc;
      this.ptab[this.curpr].xpc++;
      const r = this.exec(ir, pc);
      this.steps++;
      if (r === 'halt') { this.status = 'done'; return false; }
      if (r === 'input') { pr.pc = pc; this.status = 'input'; this.waitingInput = pr; return false; }
      return true;
    } catch (e) {
      if (!(e instanceof VMHalt)) throw e;
      this.status = 'error';
      const p = this.ptab[this.curpr];
      const line = this.pcLine[Math.max(0, Math.min(this.code.length - 1, (this.lastPc != null ? this.lastPc : p.pc)))];
      this.error = { msg: e.message, line, proc: this.procName(p) };
      return false;
    }
  }
  allDone() { return this.ptab.every((p, i) => i === 0 ? true : (p.tabix < 0 || p.done)) && this.ptab[0].done; }
  exec(ir, pc) {
    const s = this.s, tab = this.tab, btab = this.btab, atab = this.atab;
    const pr = this.ptab[this.curpr];
    let h1, h2, h3, h4, h5, h6;
    const push = v => { pr.t = this.sa(pr.t + 1); s[pr.t] = v; };
    switch (ir.f) {
      case OP.LOAD_ADDR: push(this.sa(pr.display[ir.x] + ir.y)); break;
      case OP.LOAD_VALUE: push(s[this.sa(pr.display[ir.x] + ir.y)]); break;
      case OP.LOAD_INDIR: h1 = this.sa(pr.display[ir.x] + ir.y); push(s[this.sa(s[h1])]); break;
      case OP.UPDATE_DISPLAY:
        h1 = ir.y; h2 = ir.x; h3 = pr.b;
        do { pr.display[h1] = h3; h1--; h3 = s[this.sa(h3 + 2)]; } while (h1 !== h2 && h1 >= 0);
        break;
      case OP.COBEGIN: this.pflag = 1; this.initProcDisplays(); break;
      case OP.COEND:
        this.pflag = 0; this.ptab[0].active = 0;
        if (this.npr === 0) this.ptab[0].active = 1;
        break;
      case OP.P_WAIT:
        h1 = this.sa(s[pr.t]);
        pr.t--;
        if (s[h1] > 0) s[h1]--;
        else { pr.suspend = h1; pr.waitKind = 'sem'; this.stepcount = 0; }
        break;
      case OP.V_SIGNAL: {
        h1 = this.sa(s[pr.t]);
        pr.t--;
        h2 = PMAXP1; h3 = this.rand(h2); h4 = 1 + this.rand(PMAX);
        while (h2 >= 0 && !(this.ptab[h3].suspend === h1 && this.ptab[h3].waitKind === 'sem')) { h3 = (h3 + h4) % PMAXP1; h2--; }
        if (h2 < 0) {
          s[h1]++;
          if (ir.y && s[h1] > 1) throw new VMHalt('bsemchk');
        } else { this.ptab[h3].suspend = -1; this.ptab[h3].waitKind = null; }
        break;
      }
      case OP.ENTERMON:
        h6 = s[this.sa(pr.b + 4)];
        h5 = s[this.sa(s[pr.b + 3] + 4)];
        if (tab[h5] && tab[h5].mon !== 0 && tab[h5].obj !== monitorObj) {
          if (tab[h6].mon !== tab[h5].mon) throw new VMHalt('xmonchk');
        } else {
          h4 = tab[ir.y].mon;
          pr.monitor = h4;
          if (s[h4] === 0) { this.stepcount = 0; pr.active = 0; pr.suspend = -1; pr.signaled = false; }
          else s[h4]--;
        }
        break;
      case OP.EXITMON:
        h6 = s[this.sa(pr.b + 4)];
        h5 = s[this.sa(s[pr.b + 3] + 4)];
        if (tab[h5] && tab[h5].mon !== 0 && tab[h5].obj !== monitorObj) {
          if (tab[h6].mon !== tab[h5].mon) throw new VMHalt('xmonchk');
        } else {
          h4 = this.sa(pr.monitor);
          pr.monitor = 0;
          this.releaseMonitor(h4);
        }
        break;
      case OP.WAITC:
        h4 = this.sa(pr.monitor);
        pr.suspend = s[pr.t - 1];
        pr.priority = s[pr.t];
        pr.waitKind = 'cond';
        pr.t -= 2;
        pr.active = 0;
        this.stepcount = 0;
        this.releaseMonitor(h4);
        break;
      case OP.SIGNALC: {
        h4 = this.sa(pr.monitor);
        h1 = s[pr.t]; pr.t--;
        h3 = this.rand(PMAXP1); h6 = 1 + this.rand(PMAX); h5 = 0;
        let minprior = MAXPRIO;
        for (h2 = 0; h2 <= PMAX; h2++) {
          const q = this.ptab[h3];
          if (q.suspend === h1 && q.waitKind === 'cond' && q.monitor === h4 && q.priority < minprior) { minprior = q.priority; h5 = h3; }
          h3 = (h3 + h6) % PMAXP1;
        }
        if (h5 !== 0) {
          pr.active = 0; pr.signaled = true;
          this.stepcount = 0;
          this.ptab[h5].active = 1; this.ptab[h5].suspend = -1; this.ptab[h5].waitKind = null;
        }
        break;
      }
      case OP.EMPTY:
        h1 = s[pr.t]; h3 = 0;
        for (h2 = 1; h2 <= PMAX; h2++) if (this.ptab[h2].suspend === h1 && this.ptab[h2].waitKind === 'cond') h3 = 1;
        s[pr.t] = h3 === 0 ? 1 : 0;
        break;
      case OP.EOLN_OR_EOF: push(0); break;
      case OP.JUMP: pr.pc = this.pa(ir.y); break;
      case OP.JZER: if (s[pr.t] === 0) pr.pc = this.pa(ir.y); pr.t--; break;
      case OP.BEGINFOR:
        h1 = s[this.sa(pr.t - 1)];
        if (h1 <= s[pr.t]) s[this.sa(s[this.sa(pr.t - 2)])] = h1;
        else { pr.t -= 3; pr.pc = this.pa(ir.y); }
        break;
      case OP.ENDFOR:
        h2 = s[this.sa(pr.t - 2)]; h1 = s[h2] + 1;
        if (h1 <= s[pr.t]) { s[h2] = h1; pr.pc = this.pa(ir.y); } else pr.t = this.sa(pr.t - 3);
        break;
      case OP.MARKSTACK:
        h1 = btab[tab[ir.y].ref].vsize;
        if (pr.t + h1 > pr.stacksize) throw new VMHalt('stkchk');
        pr.t += 5;
        s[pr.t - 1] = h1 - 1;
        s[pr.t] = ir.y;
        break;
      case OP.CALL: {
        pr.active = 1;
        h1 = pr.t - ir.y;
        h2 = s[this.sa(h1 + 4)];
        h3 = tab[h2].lev;
        pr.display[h3 + 1] = h1;
        h4 = this.sa(s[h1 + 3] + h1);
        s[h1 + 1] = pr.pc;
        if (ir.x === -1) {
          h5 = tab[tab[h2].mon].mon;
          pr.display[h3] = h5;
          s[h1 + 2] = h5;
        } else s[h1 + 2] = pr.display[h3];
        if (this.pflag) { s[h1 + 3] = this.ptab[0].b; pr.tabix = h2; }
        else s[h1 + 3] = pr.b;
        for (let k = pr.t + 1; k <= h4; k++) s[k] = 0;
        pr.b = h1; pr.t = h4;
        pr.pc = this.pa(tab[h2].adr);
        if (tab[h2].atomic) pr.atomic++;
        if (this.pflag) { pr.active = 1; pr.name = this.callName(h2, h1); pr.done = false; }
        break;
      }
      case OP.INDEX:
        h1 = ir.y; h2 = atab[h1].low; h3 = s[pr.t];
        if (h3 < h2 || h3 > atab[h1].high) throw new VMHalt('inxchk', `índice ${h3} fuera del rango ${atab[h1].low}..${atab[h1].high} del arreglo`);
        pr.t--;
        s[pr.t] = s[pr.t] + (h3 - h2) * atab[h1].elsize;
        break;
      case OP.LOAD_BLOCK:
        h1 = s[pr.t]; pr.t--; h2 = ir.y + pr.t;
        if (h2 > pr.stacksize) throw new VMHalt('stkchk');
        while (pr.t < h2) { pr.t = this.sa(pr.t + 1); s[pr.t] = s[h1]; h1++; }
        break;
      case OP.COPY_BLOCK:
        h1 = s[this.sa(pr.t - 1)]; h2 = s[pr.t]; h3 = h1 + ir.y;
        while (h1 < h3) s[this.sa(h1++)] = s[this.sa(h2++)];
        pr.t -= 2;
        break;
      case OP.PUSH_LIT: push(ir.y); break;
      case OP.READ: {
        const kind = ir.y === chars ? 'char' : 'int';
        const v = this.readInput(kind);
        if (v === null) {
          if (ir.x === 1) { s[this.sa(s[pr.t])] = kind === 'char' ? FLAG_CHAR : FLAG_INT; pr.t--; break; }   // nbcin
          return 'input';
        }
        if (typeof v === 'object') throw new VMHalt('inpchk', `"${v.bad}" no es un número`);
        s[this.sa(s[pr.t])] = v;
        pr.t--;
        break;
      }
      case OP.WRITE_RAWSTRING: this.write(pr, this.cstr(this.stab, ir.y)); break;
      case OP.WRITE: {
        const v = s[pr.t];
        if (ir.y === ints || ir.y === sems || ir.y === bsems) this.write(pr, String(v));
        else if (ir.y === bools) this.write(pr, v === 0 ? 'FALSE' : 'TRUE');
        else if (ir.y === chars) {
          if (v !== 10 && v !== 9 && v !== 13 && (v < 32 || v > 126)) throw new VMHalt('charchk', `cout de un char con código ${v}, que no se puede mostrar`);
          this.write(pr, String.fromCharCode(v));
        } else throw new VMHalt('wrtchk');
        pr.t--;
        break;
      }
      case OP.HALT: this.ptab[0].done = true; return 'halt';
      case OP.EXIT_PROC:
        h1 = s[this.sa(pr.b + 4)];
        if (tab[h1] && tab[h1].atomic) pr.atomic--;
        pr.t = this.sa(pr.b - 1 < 0 ? 0 : pr.b - 1);
        pr.pc = this.pa(s[pr.b + 1]);
        if (pr.pc !== 0) {
          h2 = s[this.sa(pr.b + 3)];
          if (s[h2 + 1] === -1) h2 = this.sa(s[h2 + 3]);
          pr.b = h2;
        } else {
          this.npr--;
          pr.active = 0; pr.done = true;
          this.stepcount = 0;
          this.ptab[0].active = this.npr === 0 && !this.pflag ? 1 : 0;
        }
        break;
      case OP.EXIT_FCN:
        h1 = s[this.sa(pr.b + 4)];
        if (tab[h1] && tab[h1].atomic) pr.atomic--;
        pr.t = pr.b;
        pr.pc = this.pa(s[pr.b + 1]);
        h2 = s[pr.b + 3];
        if (s[h2 + 1] === -1) h2 = s[h2 + 3];
        pr.b = h2;
        break;
      case OP.VALUE_AT: s[pr.t] = s[this.sa(s[pr.t])]; break;
      case OP.COMPLEMENT: s[pr.t] = s[pr.t] === 1 ? 0 : 1; break;
      case OP.NEGATE: s[pr.t] = -s[pr.t]; break;
      case OP.STORE_KEEP:
        h1 = this.sa(s[pr.t - 1]);
        this.noteSemStore(h1, s[pr.t]);
        s[h1] = s[pr.t]; s[pr.t - 1] = s[pr.t]; pr.t -= 1;
        break;
      case OP.STORE:
        h1 = this.sa(s[pr.t - 1]);
        this.noteSemStore(h1, s[pr.t]);
        s[h1] = s[pr.t]; pr.t -= 2;
        break;
      case OP.STORE_SEM:
        if (s[pr.t] < 0) throw new VMHalt('semchk');
        if (ir.y && s[pr.t] > 1) throw new VMHalt('bsemchk');
        h1 = this.sa(s[pr.t - 1]);
        this.semInit.set(h1, s[pr.t]);
        s[h1] = s[pr.t]; pr.t -= 2;
        break;
      case OP.CALL_MONINIT:
        h1 = this.sa(this.ptab[0].t - 4);
        h2 = s[h1 + 4]; h3 = tab[h2].lev; h4 = s[h1 + 3] + h1;
        s[h1] = 1;
        s[h1 + 1] = this.ptab[0].pc;
        s[h1 + 2] = this.ptab[0].display[1];
        s[h1 + 3] = this.ptab[0].display[1];
        pr.display[h3 + 1] = h1;
        for (let k = pr.t + 1; k <= h4; k++) s[k] = 0;
        tab[h2].mon = h1;
        pr.t = h4; pr.b = h1;
        pr.pc = this.pa(tab[h2].adr);
        break;
      case OP.RET_MONINIT:
        pr.pc = this.pa(s[this.sa(pr.b + 1)]);
        s[pr.b + 1] = -1;
        pr.b = s[this.sa(pr.b + 2)];
        pr.display[1] = pr.b;
        break;
      case OP.TEST_EQ_KEEP: s[pr.t] = s[pr.t] === s[pr.t - 1] ? 1 : 0; break;
      case OP.TEST_EQ: pr.t--; s[pr.t] = s[pr.t] === s[pr.t + 1] ? 1 : 0; break;
      case OP.TEST_NE: pr.t--; s[pr.t] = s[pr.t] !== s[pr.t + 1] ? 1 : 0; break;
      case OP.TEST_LT: pr.t--; s[pr.t] = s[pr.t] < s[pr.t + 1] ? 1 : 0; break;
      case OP.TEST_LE: pr.t--; s[pr.t] = s[pr.t] <= s[pr.t + 1] ? 1 : 0; break;
      case OP.TEST_GT: pr.t--; s[pr.t] = s[pr.t] > s[pr.t + 1] ? 1 : 0; break;
      case OP.TEST_GE: pr.t--; s[pr.t] = s[pr.t] >= s[pr.t + 1] ? 1 : 0; break;
      case OP.DO_OR: pr.t--; s[pr.t] = s[pr.t] | s[pr.t + 1]; break;
      case OP.DO_ADD: pr.t--; s[pr.t] = s[pr.t] + s[pr.t + 1]; break;
      case OP.DO_SUB: pr.t--; s[pr.t] = s[pr.t] - s[pr.t + 1]; break;
      case OP.DO_AND: pr.t--; s[pr.t] = s[pr.t] & s[pr.t + 1]; break;
      case OP.DO_MUL: pr.t--; s[pr.t] = Math.imul(s[pr.t], s[pr.t + 1]); break;
      case OP.DO_DIV: pr.t--; if (s[pr.t + 1] === 0) throw new VMHalt('divchk'); s[pr.t] = (s[pr.t] / s[pr.t + 1]) | 0; break;
      case OP.DO_MOD: pr.t--; if (s[pr.t + 1] === 0) throw new VMHalt('divchk'); s[pr.t] = s[pr.t] % s[pr.t + 1]; break;
      case OP.READLN: break;
      case OP.WRITELN: this.write(pr, '\n'); break;
      case OP.WHICH_PROC: push(this.curpr); break;
      case OP.SUSPEND:
        if (pr.atomic) { this.status = 'deadlock'; throw new VMHalt('deadlock', 'suspend dentro de una función atomic'); }
        pr.active = 0; pr.suspend = -1; pr.waitKind = 'suspend';
        this.stepcount = 0;
        break;
      case OP.REVIVE:
        h1 = s[pr.t]; pr.t--;
        if (h1 >= PMAX || h1 < 0 || this.ptab[h1].tabix < 0) throw new VMHalt('procchk');
        this.ptab[h1].active = 1; this.ptab[h1].suspend = -1;
        if (this.ptab[h1].waitKind === 'suspend') this.ptab[h1].waitKind = null;
        break;
      case OP.RANDOM: h1 = s[pr.t]; s[pr.t] = h1 > 0 ? this.rand(h1) : 0; break;
      case OP.SHORTCALL: this.shortcall = pr.pc; pr.pc = this.pa(ir.y); break;
      case OP.SHORTRET: pr.pc = this.pa(this.shortcall); break;
      case OP.SSCANF_OP: {
        h1 = s[pr.t]; h2 = this.sa(pr.t - h1 - 1);
        const src = this.readStr(s[h2]), fmt = this.cstr(this.stab, ir.y);
        const addrs = []; for (let k = 1; k <= h1; k++) addrs.push(s[h2 + k]);
        const n = this.scan(src, fmt, addrs);
        pr.t -= h1 + 1; s[pr.t] = n;
        break;
      }
      case OP.SPRINTF_OP: {
        h1 = s[pr.t]; h2 = this.sa(pr.t - h1 - 1);
        const fmt = this.cstr(this.stab, ir.y);
        const raw = []; for (let k = 1; k <= h1; k++) raw.push(s[h2 + k]);
        let ai = 0;
        const args = [];
        fmt.replace(/%([-0+ #]*)(\d+)?(?:\.(\d+))?([dioxXcsq%])/g, (m, a, b, c, conv) => { if (conv !== '%') { const v = raw[ai++]; args.push(conv === 's' || conv === 'q' ? this.readStr(v) : v); } return m; });
        this.writeStr(s[h2], cfmt(fmt, args));
        pr.t -= h1 + 2;
        break;
      }
      case OP.WRITE_STRING: this.write(pr, this.readStr(this.sa(s[pr.t]))); pr.t--; break;
      case OP.COPY_RAWSTRING: this.writeStr(this.sa(s[pr.t]), this.cstr(this.stab, ir.y)); pr.t--; break;
      case OP.COPY_STRING: this.writeStr(this.sa(s[pr.t - 1]), this.readStr(this.sa(s[pr.t]))); pr.t -= 2; break;
      case OP.CONCAT_RAWSTRING: h1 = this.sa(s[pr.t]); this.writeStr(h1, this.readStr(h1) + this.cstr(this.stab, ir.y)); pr.t--; break;
      case OP.CONCAT_STRING: h1 = this.sa(s[pr.t - 1]); this.writeStr(h1, this.readStr(h1) + this.readStr(this.sa(s[pr.t]))); pr.t -= 2; break;
      case OP.COMPARE_RAWSTRING: s[pr.t] = strcmp(this.readStr(this.sa(s[pr.t])), this.cstr(this.stab, ir.y)); break;
      case OP.COMPARE_STRING: h1 = this.readStr(this.sa(s[pr.t - 1])); h2 = this.readStr(this.sa(s[pr.t])); pr.t--; s[pr.t] = strcmp(h1, h2); break;
      case OP.LENGTH_STRING: s[pr.t] = this.readStr(this.sa(s[pr.t])).length; break;
      case OP.CREATE: case OP.CHANGECOLOR: case OP.MAKEVISIBLE: case OP.MOVETO: case OP.MOVEBY: {
        const n = { [OP.CREATE]: 7, [OP.CHANGECOLOR]: 2, [OP.MAKEVISIBLE]: 2, [OP.MOVETO]: 3, [OP.MOVEBY]: 3 }[ir.f];
        const v = []; for (let k = n - 1; k >= 0; k--) v.push(s[pr.t - k]);
        pr.t -= n;
        if (ir.f === OP.CREATE) this.gfx.set(v[0], { fig: v[1], color: v[2], x: v[3], y: v[4], s1: v[5], s2: v[6], visible: true });
        else {
          const f = this.gfx.get(v[0]);
          if (f) {
            if (ir.f === OP.CHANGECOLOR) f.color = v[1];
            else if (ir.f === OP.MAKEVISIBLE) f.visible = !!v[1];
            else if (ir.f === OP.MOVETO) { if (f.fig === 2) { f.s1 += v[1] - f.x; f.s2 += v[2] - f.y; } f.x = v[1]; f.y = v[2]; }
            else { f.x += v[1]; f.y += v[2]; if (f.fig === 2) { f.s1 += v[1]; f.s2 += v[2]; } }
          }
        }
        this.gfxVer++;
        break;
      }
      case OP.POST: {
        const c = s[pr.t - 2], a = s[pr.t - 1], b = s[pr.t];
        pr.t -= 3;
        this.board.push({ c, a, b, id: this.noteSeq++ });
        for (const q of this.ptab) if (q.linda) { q.linda = null; q.suspend = -1; q.waitKind = null; }
        break;
      }
      case OP.REMOVE: {
        const c = s[pr.t - 2], a1 = s[pr.t - 1], a2 = s[pr.t];
        const slots = [a1, a2].map((addr, i) => (addr === FLAG_INT ? null : { addr: this.sa(addr), eq: !!(ir.y & (1 << i)) }));
        const idx = this.board.findIndex(n => n.c === c && slots.every((sl, i) => !sl || !sl.eq || (i === 0 ? n.a : n.b) === s[sl.addr]));
        if (idx >= 0) {
          const n = this.board[idx];
          if (ir.x === 0) this.board.splice(idx, 1);
          slots.forEach((sl, i) => { if (sl) s[sl.addr] = i === 0 ? n.a : n.b; });
          pr.t -= 3;
        } else {
          // espera una nota: vuelve a ejecutar REMOVE cuando alguien haga postnote
          pr.pc = pc;
          const want = [String.fromCharCode(c)].concat(slots.filter(Boolean).map(sl => (sl.eq ? String(s[sl.addr]) : '?')));
          pr.linda = { name: `(${want.join(', ')})` };
          pr.waitKind = 'linda';
          this.stepcount = 0;
        }
        break;
      }
      default: throw new VMHalt('pcodchk', `instrucción PCODE ${ir.f} no soportada`);
    }
    return null;
  }
  releaseMonitor(h4) {
    const s = this.s;
    let h2 = PMAXP1, h3 = this.rand(h2);
    const h5 = 1 + this.rand(PMAX);
    while (h2 >= 0 && (this.ptab[h3].monitor !== h4 || this.ptab[h3].suspend >= 0 || this.ptab[h3].active !== 0 || this.ptab[h3].done)) { h3 = (h3 + h5) % PMAXP1; h2--; }
    if (h2 < 0) s[h4]++;
    else { this.ptab[h3].active = 1; this.ptab[h3].signaled = false; }
  }
  noteSemStore(addr, v) { if (this.semAddrs && this.semAddrs.has(addr) && !this.semInit.has(addr)) this.semInit.set(addr, v); }
  callName(tix, b) {
    const t = this.tab[tix]; const args = [];
    const lp = this.btab[t.ref].lastpar;
    for (let i = tix + 1; i <= lp && i < this.tab.length; i++) {
      const pa = this.tab[i];
      if (pa.obj !== variable) continue;
      const v = this.s[b + pa.adr];
      if (pa.typ === ints && pa.normal) args.push(String(v));
      else if (pa.typ === chars && pa.normal) args.push(`'${String.fromCharCode(v)}'`);
      else args.push(pa.name);
    }
    return `${t.name}(${args.join(', ')})`;
  }
  /* ------------------------------------------------- texto y E/S */
  cstr(str, i) { const j = str.indexOf('\0', i); return str.slice(i, j < 0 ? str.length : j); }
  readStr(addr) {
    let out = '', i = addr * 4;
    while (i < this.bytes.length && this.bytes[i] !== 0 && out.length < 4096) out += String.fromCharCode(this.bytes[i++]);
    return out;
  }
  writeStr(addr, str) {
    let i = addr * 4;
    for (let k = 0; k < str.length && i < this.bytes.length - 1; k++) this.bytes[i++] = str.charCodeAt(k) & 255;
    this.bytes[i] = 0;
  }
  scan(src, fmt, addrs) {
    let si = 0, count = 0, ti = 0;
    const ws = c => /\s/.test(c);
    for (let fi = 0; fi < fmt.length; fi++) {
      const f = fmt[fi];
      if (ws(f)) { while (si < src.length && ws(src[si])) si++; continue; }
      if (f !== '%') { if (src[si] !== f) return count; si++; continue; }
      const conv = fmt[++fi];
      if (conv === '%') { if (src[si] !== '%') return count; si++; continue; }
      if (ti >= addrs.length) return count;
      const a = addrs[ti++];
      while (si < src.length && ws(src[si])) si++;
      if (si >= src.length) return count;
      const rest = src.slice(si);
      if (conv === 'd') { const m = /^[-+]?\d+/.exec(rest); if (!m) return count; this.s[a] = parseInt(m[0], 10) | 0; si += m[0].length; }
      else if (conv === 'x') { const m = /^(0[xX])?[0-9a-fA-F]+/.exec(rest); if (!m) return count; this.s[a] = parseInt(m[0].replace(/^0[xX]/, ''), 16) | 0; si += m[0].length; }
      else if (conv === 's') { let j = si; while (j < src.length && !ws(src[j])) j++; this.writeStr(a, src.slice(si, j)); si = j; }
      else if (conv === 'q') { if (src[si] !== '"') return count; const j = src.indexOf('"', si + 1); if (j < 0) return count; this.writeStr(a, src.slice(si + 1, j)); si = j + 1; }
      else return count;
      count++;
    }
    return count;
  }
  write(pr, text) {
    const proc = this.ui(pr);
    const segs = this.out, last = segs[segs.length - 1];
    if (last && last.pid === proc.pid && !last.cls) last.text += text;
    else segs.push({ pid: proc.pid, color: proc.color || 0, text });
    if (segs.length > 4000) { segs.splice(0, 1000); this.outBase++; }
  }
  provideInput(text) {
    this.inBuf += text + '\n';
    this.out.push({ pid: -8, color: 0, text: text + '\n', cls: 'in' });
    if (this.status === 'input') { this.status = 'running'; this.waitingInput = null; this.stepcount = 1; }
    this._dirty = true;
  }
  readInput(kind) {
    const b = this.inBuf; let i = 0;
    const isWs = c => c === ' ' || c === '\t' || c === '\n' || c === '\r';
    while (i < b.length && isWs(b[i])) i++;
    if (i >= b.length) return null;
    if (kind === 'char') { this.inBuf = b.slice(i + 1); return b.charCodeAt(i); }
    let j = i; while (j < b.length && !isWs(b[j])) j++;
    const word = b.slice(i, j);
    const m = /^[-+]?\d+/.exec(word);
    if (!m) { this.inBuf = b.slice(j); return { bad: word }; }
    this.inBuf = b.slice(i + m[0].length);
    return parseInt(m[0], 10) | 0;
  }
  /* --------------------------------------- vista para la interfaz */
  ui(pr) {
    if (!this._ui) this._ui = [];
    let u = this._ui[pr.pid];
    if (!u) u = this._ui[pr.pid] = { pid: pr.pid, name: '', color: pr.pid === 0 ? 0 : ((pr.pid - 1) % 8) + 1, state: 'ready', line: 0, blockKind: null, blockedOn: null, mon: null, children: 0, pc: 0 };
    return u;
  }
  procName(pr) { return pr.pid === 0 ? 'main' : pr.name || `proceso ${pr.pid}`; }
  sync() {
    if (!this._dirty || !this.ptab) return;
    this._dirty = false;
    const mons = this.monitorsMap();
    const condByAddr = new Map(), monByAddr = new Map(), semByAddr = new Map();
    for (const m of mons.values()) { monByAddr.set(m.addr, m); for (const c of m.conds) condByAddr.set(c.addr, c); }
    const semsL = this.semList();
    for (const x of semsL) semByAddr.set(x.addr, x);
    const list = [];
    for (const pr of this.ptab) {
      if (pr.pid !== 0 && pr.tabix < 0) continue;
      const u = this.ui(pr);
      u.name = this.procName(pr);
      u.pc = pr.pc;
      u.blockKind = null; u.blockedOn = null; u.mon = null;
      const blockedInstr = pr.done ? null : (pr.suspend >= 0 || pr.active === 0 || pr.linda);
      u.line = this.pcLine[Math.max(0, Math.min(this.code.length - 1, blockedInstr && pr.waitKind !== 'linda' ? pr.pc - 1 : pr.pc))];
      if (pr.done) { u.state = 'done'; u.line = null; }
      else if (pr.pid === 0 && this.pflag === 0 && pr.active === 0 && this.npr > 0) { u.state = 'cobegin'; u.children = this.npr; }
      else if (this.status === 'input' && this.waitingInput === pr) { u.state = 'blocked'; u.blockKind = 'input'; u.blockedOn = { name: 'cin' }; }
      else if (pr.linda) { u.state = 'blocked'; u.blockKind = 'linda'; u.blockedOn = pr.linda; }
      else if (pr.suspend >= 0) {
        u.state = 'blocked';
        if (pr.waitKind === 'cond') { u.blockKind = 'cond'; u.blockedOn = condByAddr.get(pr.suspend) || { name: '?', mon: { name: '?' } }; }
        else { u.blockKind = 'sem'; u.blockedOn = semByAddr.get(pr.suspend) || { name: this.nameOfAddr(pr.suspend) }; }
      } else if (pr.active === 0) {
        u.state = 'blocked';
        if (pr.monitor) { const m = monByAddr.get(pr.monitor) || { name: '?' }; u.blockKind = pr.signaled ? 'urgent' : 'entry'; u.blockedOn = m; }
        else { u.blockKind = 'suspend'; u.blockedOn = { name: 'suspend' }; }
      } else u.state = 'ready';
      if (pr.monitor && !pr.done && u.state === 'ready') { const m = monByAddr.get(pr.monitor); if (m) u.mon = m; }
      list.push(u);
    }
    // colas
    for (const pr of this.ptab) {
      const u = this._ui && this._ui[pr.pid]; if (!u || (pr.pid !== 0 && pr.tabix < 0)) continue;
      if (u.blockKind === 'sem' && u.blockedOn && u.blockedOn.queue) u.blockedOn.queue.push(u);
      if (u.blockKind === 'cond' && u.blockedOn && u.blockedOn.queue) u.blockedOn.queue.push({ proc: u, prio: pr.priority });
      if (u.blockKind === 'entry' && u.blockedOn && u.blockedOn.entry) u.blockedOn.entry.push(u);
      if (u.blockKind === 'urgent' && u.blockedOn && u.blockedOn.urgent) u.blockedOn.urgent.push(u);
      if (u.state === 'ready' && pr.monitor) { const m = monByAddr.get(pr.monitor); if (m && !m.owner) m.owner = u; }
    }
    for (const m of mons.values()) for (const c of m.conds) c.queue.sort((a, b) => a.prio - b.prio);
    this._procs = list; this._mons = mons; this._sems = semsL;
  }
  get procs() { this.sync(); return this._procs || []; }
  get monitors() { this.sync(); return this._mons || new Map(); }
  get sems() { this.sync(); return this._sems || []; }
  get cur() { if (!this.ptab || this.lastPid < 0) return null; this.sync(); return this._ui ? this._ui[this.curpr] || null : null; }
  get last() { if (!this.ptab || this.lastPid < 0) return null; this.sync(); return this._ui ? this._ui[this.lastPid] || null : null; }
  get main() { return this.ptab ? this.ui(this.ptab[0]) : null; }
  // variables de un bloque: recorre la tabla de identificadores como lo hace jBACI
  blockVars(bix, lev) {
    const out = [];
    if (lev == null) lev = bix === 0 ? 0 : 1;
    let i = this.btab[bix] ? this.btab[bix].last : 0, guard = 0;
    while (i > 0 && this.tab[i] && guard++ < 100000) { if (this.tab[i].lev === lev) out.unshift(this.tab[i]); i = this.tab[i].link; }
    return out;
  }
  cellAt(t, addr, typ, ref) {
    const s = this.s;
    typ = typ == null ? t.typ : typ; ref = ref == null ? t.ref : ref;
    if (typ === arrays) {
      const a = this.atab[ref]; const items = [];
      if (!a) return { kind: 'arr', items };
      for (let k = a.low; k <= a.high && items.length < 64; k++) items.push(this.cellAt(t, addr + (k - a.low) * a.elsize, a.eltyp, a.elref));
      return { kind: 'arr', items, type: a.eltyp === sems || a.eltyp === bsems ? 'semaphore' : a.eltyp === conds ? 'condition' : 'int' };
    }
    if (typ === strings) return { kind: 'str', s: this.readStr(addr) };
    if (typ === sems || typ === bsems) return { kind: 'sem', sem: { value: s[addr] } };
    if (typ === conds) return { kind: 'cond' };
    return { kind: 'int', type: typ === chars ? 'char' : 'int', v: s[addr] };
  }
  get globals() {
    const m = new Map();
    if (!this.ptab) return m;
    for (const t of this.blockVars(0)) {
      if (t.obj === variable) m.set(t.name, this.cellAt(t, t.adr));
      else if (t.obj === constant) m.set(t.name, { kind: 'int', type: t.typ === chars ? 'char' : 'int', v: t.adr, isConst: true });
    }
    return m;
  }
  monitorsMap() {
    const out = new Map();
    for (let i = 1; i < this.tab.length; i++) {
      const t = this.tab[i];
      if (t.obj !== monitorObj) continue;
      const base = t.mon;     // dirección del registro del monitor (CALL_MONINIT la anota en tab.mon)
      const m = { name: t.name, addr: base, owner: null, entry: [], urgent: [], conds: [], scope: { vars: new Map() } };
      for (const v of this.blockVars(t.ref)) {
        if (v.obj !== variable) continue;
        if (!base) continue;
        if (v.typ === conds) m.conds.push({ name: v.name, addr: base + v.adr, mon: m, queue: [] });
        else if (v.typ === arrays && this.atab[v.ref] && this.atab[v.ref].eltyp === conds) {
          const a = this.atab[v.ref];
          for (let k = a.low; k <= a.high; k++) m.conds.push({ name: `${v.name}[${k}]`, addr: base + v.adr + (k - a.low) * a.elsize, mon: m, queue: [] });
        } else m.scope.vars.set(v.name, this.cellAt(v, base + v.adr));
      }
      out.set(t.name, m);
    }
    return out;
  }
  semList() {
    const out = [];
    const add = (t, base, local) => {
      if (t.obj !== variable) return;
      if (t.typ === sems || t.typ === bsems) out.push({ name: t.name, addr: base + t.adr, binary: t.typ === bsems, local });
      else if (t.typ === arrays && this.atab[t.ref] && (this.atab[t.ref].eltyp === sems || this.atab[t.ref].eltyp === bsems)) {
        const a = this.atab[t.ref];
        for (let k = a.low; k <= a.high; k++) out.push({ name: `${t.name}[${k}]`, addr: base + t.adr + (k - a.low) * a.elsize, binary: a.eltyp === bsems, local });
      }
    };
    for (const t of this.blockVars(0)) add(t, 0, false);
    const mainTix = this.btab[0].lastpar;
    if (mainTix && this.tab[mainTix]) for (const t of this.blockVars(this.tab[mainTix].ref)) add(t, this.btab[0].vsize, true);
    for (const x of out) { x.value = this.s[x.addr]; x.init = this.semInit.has(x.addr) ? this.semInit.get(x.addr) : x.value; x.queue = []; }
    return out;
  }
  nameOfAddr(addr) { const x = (this._sems || []).find(q => q.addr === addr); return x ? x.name : `@${addr}`; }
  /* comentario de una instrucción, al estilo de la ventana PCode de jBACI */
  describe(pc) {
    const c = this.code[pc]; if (!c) return '';
    const tab = this.tab;
    if (!this._blocks) {
      // qué función contiene cada pc, para nombrar las variables locales
      this._blocks = tab.filter(t => t && (t.obj === 3 || t.obj === 4 || t.obj === mainproc || t.obj === monitorObj) && t.adr >= 0).sort((a, b) => a.adr - b.adr);
    }
    const varName = (lev, adr) => {
      if (lev === 0) { const v = this.blockVars(0).find(t => t.obj === variable && t.adr === adr); return v ? v.name : ''; }
      let fn = null;
      for (const b of this._blocks) if (b.adr <= pc) fn = b; else break;
      const cands = [];
      if (fn) { cands.push(...this.blockVars(fn.ref, fn.lev + 1)); if (fn.obj === 3 || fn.obj === 4) { const m = fn.mon ? tab[fn.mon] : null; if (m) cands.push(...this.blockVars(m.ref, 1)); } }
      for (let i = 1; i < tab.length; i++) if (tab[i].obj === monitorObj) cands.push(...this.blockVars(tab[i].ref, 1));
      const v = cands.find(t => t.obj === variable && t.lev === lev && t.adr === adr);
      return v ? v.name : (adr === 0 ? 'resultado' : '');
    };
    switch (c.f) {
      case OP.LOAD_ADDR: return `dirección de ${varName(c.x, c.y)}`;
      case OP.LOAD_VALUE: return `valor de ${varName(c.x, c.y)}`;
      case OP.LOAD_INDIR: return `valor apuntado por ${varName(c.x, c.y)}`;
      case OP.PUSH_LIT: return c.y === FLAG_INT ? 'vacío (Linda)' : '';
      case OP.MARKSTACK: return tab[c.y] ? tab[c.y].name : '';
      case OP.CALL: return c.x === -1 ? 'procedimiento de monitor' : '';
      case OP.JUMP: case OP.JZER: return `ir a ${c.y}`;
      case OP.WRITE_RAWSTRING: return JSON.stringify(this.cstr(this.stab, c.y));
      case OP.ENTERMON: return tab[c.y] ? tab[c.y].name : '';
      case OP.INDEX: return `arreglo ${c.y}`;
      case OP.P_WAIT: return c.y ? 'binarysem' : 'semaphore';
      case OP.V_SIGNAL: return c.y ? 'binarysem' : 'semaphore';
      case OP.SHORTCALL: return `init de monitores en ${c.y}`;
      default: return '';
    }
  }
  /* PCODE de una línea, para mostrarlo como en la ventana PCode de jBACI */
  pcodeOfLine(line) {
    const out = [];
    for (let pc = 0; pc < this.code.length; pc++) if (this.pcLine[pc] === line) out.push(pc);
    return out;
  }
}

function strcmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function cfmt(fmt, args) {
  if (root.BACI && root.BACI.cfmt) return root.BACI.cfmt(fmt, args, 0);
  let i = 0;
  return fmt.replace(/%([-0+ #]*)(\d+)?(?:\.(\d+))?([dioxXcsq%])/g, (m, f, w, p, c) => (c === '%' ? '%' : String(args[i++])));
}

const api = { PMachine, VMHalt, LF };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.BACI_VM = api;
})(typeof window !== 'undefined' ? window : globalThis);

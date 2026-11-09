# Mini BACI

Intérprete de C-- concurrente (BACI / jBACI) para Android, sin instalar nada en el PC.

Soporta lo descrito en los manuales de BACI C-- y de jBACI: `int`, `char`, `string[n]`, arreglos,
`typedef`, `switch`, funciones por valor y referencia, `cin`/`nbcin`, `#include`, `cobegin`,
`semaphore`, `binarysem`, monitores (`condition`, `waitc`, `signalc`, `empty`), `atomic`,
`suspend`/`revive`/`which_proc`, funciones de string (`sprintf`, `sscanf`...), Linda
(`postnote`, `readnote`, `removenote`...) y los gráficos de jBACI.

- `baci.js`: el intérprete (también se puede usar con Node).
- `ejemplos.js`: programas de ejemplo y los `#include` estándar (`gdefs.cm`, `iodefs.cm`).
- `index.html`: la app.

Abre la página en Chrome para Android y toca **Instalar app** (o menú ⋮ → *Instalar aplicación*).
Después funciona sin internet.

## PCode como jBACI

Con la opción **PCode (como jBACI)** (activada por defecto) el programa se compila igual que con `bacc`,
el compilador que usa jBACI, y se ejecuta con el intérprete de BACI:

- `pcode.js`: compilador de C-- a PCODE. Es una traducción del compilador original de BACI
  (`bac.y`, `bac.l`, `computil.c`, de Bill Bynum y Tracy Camp, basado en Pascal-S de Ben-Ari/Wirth),
  con lo que agrega el `bacc` de jBACI (Linda, gráficos, `nbcin`, `parbegin`, `char()`).
  Genera el mismo PCODE, las mismas tablas, el mismo `.pco` y el mismo `.lst` que `bacc.exe`
  (comprobado con 61 programas).
- `pcode-tablas.js`: tablas LALR(1) de la gramática de `bacc`, para pedir los tokens en el mismo
  momento que yacc (de eso depende la línea que se asocia a cada instrucción).
- `pcode-vm.js`: máquina virtual que ejecuta el PCODE como `bainterp` (una pila compartida, tabla de
  procesos, planificador al azar con cuantos de 0 a 4 instrucciones, monitores con su semáforo,
  cola de entrada y colas de las condition).

En la app: **Paso** avanza una línea (Step Source) y **Paso PCode** una instrucción (Step PCode).
El panel PCode muestra las instrucciones alrededor de donde va cada proceso, y se pueden descargar
el `.pco` y el `.lst`. Si el programa usa algo que `bacc` no acepta (`+=`, `?:`...), se ejecuta con
el intérprete directo (`baci.js`) y se avisa.

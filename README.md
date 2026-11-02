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

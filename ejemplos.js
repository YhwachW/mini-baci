/* Mini BACI: programas de ejemplo y archivos estándar para #include. */
(function (root) {
const EJEMPLOS = [
{ id: '01s', file: '01-impresora-semaphore.cm', name: '01 · Impresora con semaphore = 1', code:
`semaphore impresora = 1;

void persona(int id) {
    int hoja;
    cout << "Persona " << id << " quiere imprimir." << endl;

    wait(impresora);

    cout << "Persona " << id << " esta imprimiendo." << endl;
    for (hoja = 1; hoja <= 5; hoja++) {
        cout << "Persona " << id << " imprimiendo hoja " << hoja << endl;
    }
    cout << "Persona " << id << " libera la impresora." << endl;

    signal(impresora);
}

void main() {
    cobegin {
        persona(1);
        persona(2);
        persona(3);
    }

    cout << "Todos los procesos han terminado." << endl;
}
` },
{ id: '01', file: '01-impresora-uno-a-la-vez.cm', name: '01 · Impresora con binarysem', code:
`binarysem impresora = 1;

void persona(int id) {
    int hoja;
    cout << "Persona " << id << " quiere imprimir." << endl;

    wait(impresora);

    cout << "Persona " << id << " esta imprimiendo." << endl;
    for (hoja = 1; hoja <= 5; hoja++) {
        cout << "Persona " << id << " imprimiendo hoja " << hoja << endl;
    }
    cout << "Persona " << id << " libera la impresora." << endl;

    signal(impresora);
}

void main() {
    cobegin {
        persona(1);
        persona(2);
        persona(3);
    }

    cout << "Todos los procesos han terminado." << endl;
}
` },
{ id: '06', file: '06-dos-impresoras-semaphore.cm', name: '06 · Dos impresoras (semaphore = 2)', code:
`semaphore impresoras = 2;   /* GENERAL: cuantas impresoras libres hay */
binarysem pantalla  = 1;    /* BINARIO: que los cout no se mezclen   */
int usando = 0;

void persona(int id) {
    int hoja;

    wait(pantalla);
    cout << "Persona " << id << " quiere imprimir." << endl;
    signal(pantalla);

    wait(impresoras);                  /* toma una impresora libre (o espera) */

    wait(pantalla);
    usando = usando + 1;
    cout << "Persona " << id << " esta imprimiendo. Impresoras en uso: " << usando << endl;
    signal(pantalla);

    for (hoja = 1; hoja <= 3; hoja++) {
        wait(pantalla);
        cout << "Persona " << id << " imprimiendo hoja " << hoja << endl;
        signal(pantalla);
    }

    wait(pantalla);
    usando = usando - 1;
    cout << "Persona " << id << " libera su impresora. Impresoras en uso: " << usando << endl;
    signal(pantalla);

    signal(impresoras);                /* devuelve la impresora */
}

void main() {
    cobegin {
        persona(1);
        persona(2);
        persona(3);
        persona(4);
    }

    cout << "Todos los procesos han terminado." << endl;
}
` },
{ id: '02', file: '02-trafico-cruce-uno-a-la-vez.cm', name: '02 · Cruce, un auto a la vez', code:
`/*
 02-trafico-cruce-uno-a-la-vez.cm : 4 autos (procesos) quieren pasar por un cruce.
 En el cruce cabe UN solo auto a la vez; si entran dos, chocan.
 El semaforo "cruce" deja pasar a un auto por vez.

   cruce = 1  -> luz verde: el cruce esta libre
   cruce = 0  -> luz roja: hay un auto cruzando; el que llega, espera
*/

binarysem cruce = 1;

void autoQueCruza(int id) {
    int tramo;
    cout << "Auto " << id << " llega al cruce." << endl;

    wait(cruce);

    cout << "Auto " << id << " tiene VERDE y entra al cruce." << endl;
    for (tramo = 1; tramo <= 3; tramo++) {
        cout << "Auto " << id << " cruzando, tramo " << tramo << endl;
    }
    cout << "Auto " << id << " sale del cruce." << endl;

    signal(cruce);
}

void main() {
    cobegin {
        autoQueCruza(1);
        autoQueCruza(2);
        autoQueCruza(3);
        autoQueCruza(4);
    }

    cout << "Todos los autos cruzaron sin chocar." << endl;
}
` },
{ id: '03', file: '03-trafico-cruce-pantalla-protegida.cm', name: '03 · Cruce con pantalla protegida', code:
`/*
 03-trafico-cruce-pantalla-protegida.cm : igual que 02-trafico-cruce-uno-a-la-vez.cm,
 pero los mensajes ya no se mezclan.

 Problema de 02-trafico-cruce-uno-a-la-vez.cm: jBACI puede cambiar de proceso A MITAD de un cout,
 y la pantalla (Console) tambien es un recurso compartido.

 Solucion: un segundo semaforo, "pantalla", para que un solo auto
 escriba a la vez. Cada cout queda entre wait(pantalla) y signal(pantalla).

   cruce    -> protege el cruce   (un auto cruzando a la vez)
   pantalla -> protege la Console (un auto escribiendo a la vez)
*/

binarysem cruce = 1;
binarysem pantalla = 1;

void autoQueCruza(int id) {
    int tramo;

    wait(pantalla);
    cout << "Auto " << id << " llega al cruce." << endl;
    signal(pantalla);

    wait(cruce);

    wait(pantalla);
    cout << "Auto " << id << " tiene VERDE y entra al cruce." << endl;
    signal(pantalla);

    for (tramo = 1; tramo <= 3; tramo++) {
        wait(pantalla);
        cout << "Auto " << id << " cruzando, tramo " << tramo << endl;
        signal(pantalla);
    }

    wait(pantalla);
    cout << "Auto " << id << " sale del cruce." << endl;
    signal(pantalla);

    signal(cruce);
}

void main() {
    cobegin {
        autoQueCruza(1);
        autoQueCruza(2);
        autoQueCruza(3);
        autoQueCruza(4);
    }

    cout << "Todos los autos cruzaron sin chocar." << endl;
}
` },
{ id: '04', file: '04-trafico-turnos-dos-calles.cm', name: '04 · Turnos entre dos calles', code:
`/*
 04-trafico-turnos-dos-calles.cm : un cruce con DOS calles que se turnan, como un semaforo real.

   Calle Norte-Sur (NS): autos 1, 2, 3
   Calle Este-Oeste (EO): autos 4, 5, 6

 Semaforos:
   verdeNS = 1  -> Norte-Sur empieza con luz verde
   verdeEO = 0  -> Este-Oeste empieza en rojo
   pantalla     -> un solo auto escribe a la vez en la Console

 Cada auto espera SU verde, cruza y le da el verde a la OTRA calle.
 Resultado: los autos cruzan alternados NS, EO, NS, EO, NS, EO.

 Como verdeNS + verdeEO vale siempre 1 (o 0 mientras alguien cruza),
 nunca hay dos autos en el cruce a la vez.

 IMPORTANTE: las dos calles deben tener la misma cantidad de autos.
 Si una tiene mas, sus autos de sobra esperan un verde que nunca llega.
*/

binarysem verdeNS = 1;
binarysem verdeEO = 0;
binarysem pantalla = 1;

void autoNS(int id) {
    wait(pantalla);
    cout << "Auto " << id << " (Norte-Sur) llega y espera su verde." << endl;
    signal(pantalla);

    wait(verdeNS);                         /* espera verde para Norte-Sur */

    wait(pantalla);
    cout << "  >> VERDE Norte-Sur: cruza el auto " << id << endl;
    signal(pantalla);

    signal(verdeEO);                       /* le da el verde a Este-Oeste */
}

void autoEO(int id) {
    wait(pantalla);
    cout << "Auto " << id << " (Este-Oeste) llega y espera su verde." << endl;
    signal(pantalla);

    wait(verdeEO);                         /* espera verde para Este-Oeste */

    wait(pantalla);
    cout << "  >> VERDE Este-Oeste: cruza el auto " << id << endl;
    signal(pantalla);

    signal(verdeNS);                       /* le da el verde a Norte-Sur */
}

void main() {
    cobegin {
        autoNS(1); autoNS(2); autoNS(3);
        autoEO(4); autoEO(5); autoEO(6);
    }

    cout << "Todos los autos cruzaron, turnandose." << endl;
}
` },
{ id: '05', file: '05-estacionamiento-examen-2025-1.cm', name: '05 · Estacionamiento (examen 2025-1)', code:
`/*
 05-estacionamiento-examen-2025-1.cm
 Basado en el Problema 4 de la Pauta del Examen de Sistemas Operativos 2025-1
 (alli resuelto en Python y en C con pthreads; aqui en C-- para jBACI).

 Un edificio tiene un estacionamiento con capacidad para 5 autos y UNA sola
 barrera, por la que pasa un auto a la vez (para entrar o para salir).
 Cada auto es un proceso.

 Semaforos:
   cupos   = 5  -> semaforo GENERAL (contador): espacios libres.
                   Si llegan mas de 5, los que sobran esperan.
   barrera = 1  -> semaforo BINARIO: un solo auto en la barrera.
                   Tambien protege la variable "dentro" y la Console.

 Equivalencias con la pauta:
   Python: Semaphore(5).acquire() / release()   ->  wait(cupos) / signal(cupos)
   C:      sem_wait / sem_post                  ->  wait(cupos) / signal(cupos)
   C:      pthread_mutex_lock / unlock          ->  wait(barrera) / signal(barrera)
*/

semaphore cupos = 5;
binarysem barrera = 1;
int dentro = 0;

void autoResidente(int id) {
    int t;

    wait(cupos);                       /* espera un espacio libre */

    wait(barrera);                     /* entra por la barrera */
    dentro = dentro + 1;
    cout << "Auto " << id << " entra.  Autos dentro: " << dentro << endl;
    signal(barrera);

    /* tiempo estacionado.
       OJO: el original tenia "dentro = dentro;" aqui, FUERA de la barrera.
       Eso lee y vuelve a escribir "dentro" sin proteccion y puede borrar
       el cambio de otro auto (condicion de carrera). Por eso el ciclo va vacio. */
    for (t = 1; t <= 5; t++) {
    }

    wait(barrera);                     /* sale por la barrera */
    dentro = dentro - 1;
    cout << "Auto " << id << " sale.   Autos dentro: " << dentro << endl;
    signal(barrera);

    signal(cupos);                     /* libera su espacio */
}

void main() {
    cobegin {
        autoResidente(1); autoResidente(2); autoResidente(3);
        autoResidente(4); autoResidente(5); autoResidente(6);
        autoResidente(7);
    }

    cout << "Estacionamiento vacio. Autos dentro: " << dentro << endl;
}
` },
{ id: 'tl', file: 'trafficlight-corregido.cm', name: 'Semáforo de tránsito A/B (trafficlight corregido)', code:
`/*
 trafficlight corregido: dos semaforos de transito que se turnan.
 turnoA y turnoB son binarysem: no se comparan con ==,
 se usan con wait (esperar mi turno) y signal (darle el turno al otro).
*/

binarysem turnoA = 1;   /* A parte en verde */
binarysem turnoB = 0;
binarysem pantalla = 1;

void semaforoA() {
    int ciclo;
    for (ciclo = 1; ciclo <= 3; ciclo++) {
        wait(turnoA);
        wait(pantalla);
        cout << "[Semaforo A]: VERDE" << endl;
        cout << "[Semaforo A]: AMARILLO" << endl;
        cout << "[Semaforo A]: ROJO" << endl;
        signal(pantalla);
        signal(turnoB);          /* le pasa el turno a B */
    }
}

void semaforoB() {
    int ciclo;
    for (ciclo = 1; ciclo <= 3; ciclo++) {
        wait(turnoB);
        wait(pantalla);
        cout << "[Semaforo B]: VERDE" << endl;
        cout << "[Semaforo B]: AMARILLO" << endl;
        cout << "[Semaforo B]: ROJO" << endl;
        signal(pantalla);
        signal(turnoA);          /* le devuelve el turno a A */
    }
}

void main() {
    cobegin {
        semaforoA();
        semaforoB();
    }
    cout << "Fin: 3 ciclos de cada semaforo." << endl;
}
` },
{ id: 'c1', file: 'contador-sin-proteccion.cm', name: 'Contador sin protección (condición de carrera)', code:
`/*
 Dos procesos suman 1 a "cuenta" 20 veces cada uno, SIN semaforo.
 Deberia terminar en 40, pero a veces da menos:
 un proceso lee cuenta, lo interrumpen, el otro suma, y el primero
 guarda un valor viejo (se pierde una suma).
*/

int cuenta = 0;

void sumar(int id) {
    int i;
    for (i = 1; i <= 20; i++) {
        cuenta = cuenta + 1;
    }
}

void main() {
    cobegin {
        sumar(1);
        sumar(2);
    }
    cout << "cuenta = " << cuenta << " (deberia ser 40)" << endl;
}
` },
{ id: 'c2', file: 'contador-con-mutex.cm', name: 'Contador con binarysem (siempre 40)', code:
`/* Igual que el anterior, pero la suma queda protegida por un binarysem. */

int cuenta = 0;
binarysem mutex = 1;

void sumar(int id) {
    int i;
    for (i = 1; i <= 20; i++) {
        wait(mutex);
        cuenta = cuenta + 1;
        signal(mutex);
    }
}

void main() {
    cobegin {
        sumar(1);
        sumar(2);
    }
    cout << "cuenta = " << cuenta << " (deberia ser 40)" << endl;
}
` },
{ id: 'm1', file: 'impresora-monitor.cm', name: 'Monitor · Impresora con monitor', code:
`/*
 Impresora con MONITOR: el mismo problema del ejercicio 01,
 pero sin wait/signal. El monitor garantiza que solo un proceso
 a la vez ejecuta tomar() o soltar().

   ocupada -> 1 si alguien esta imprimiendo
   libre   -> condition donde esperan los que encuentran la impresora ocupada
*/

monitor Impresora {
    int ocupada;
    condition libre;

    void tomar(int id) {
        if (ocupada)
            waitc(libre);          /* suelta el monitor y espera */
        ocupada = 1;
        cout << "Persona " << id << " toma la impresora." << endl;
    }

    void soltar(int id) {
        ocupada = 0;
        cout << "Persona " << id << " suelta la impresora." << endl;
        signalc(libre);            /* despierta a uno (si hay alguien) */
    }

    init { ocupada = 0; }
}

void persona(int id) {
    int hoja;
    tomar(id);
    for (hoja = 1; hoja <= 3; hoja++) {
        cout << "Persona " << id << " imprimiendo hoja " << hoja << endl;
    }
    soltar(id);
}

void main() {
    cobegin {
        persona(1);
        persona(2);
        persona(3);
    }
    cout << "Todos los procesos han terminado." << endl;
}
` },
{ id: 'm2', file: 'contador-mon.cm', name: 'Monitor · Contador (contador-mon.cm)', code:
`/*
 contador-mon.cm : el mismo contador protegido por un MONITOR.
 Solo un proceso a la vez puede estar dentro de un procedimiento
 del monitor, asi que no hacen falta wait ni signal.
*/
monitor Contador {
  int valor;

  void incrementar(int id) {
    int local;
    local = valor;
    valor = local + 1;
    cout << "Proceso " << id << " -> contador = " << valor << endl;
  }

  int leer() {
    return valor;
  }

  init { valor = 0; }
}

void proceso(int id) {
  int i;
  for (i = 1; i <= 3; i++)
    incrementar(id);
}

void main() {
  cobegin {
    proceso(1); proceso(2);
  }
  cout << "Final: " << leer() << endl;
}
` },
{ id: 'm3', file: 'p-c-mon.cm', name: 'Monitor · Productor-consumidor (p-c-mon.cm)', code:
`monitor PC {
	const int N = 5;
	int Oldest;
	int Newest;
	int Count;
	condition NotEmpty;
	condition NotFull;
	int Buffer[N];

void Append(int V) {
	if (Count == N) 
		waitc(NotFull);
	Buffer[Newest] = V;
	Newest = (Newest + 1) % N;
	Count = Count + 1;
	signalc(NotEmpty);
}

int Take() {
	int temp;
	if (Count == 0) 
		waitc(NotEmpty);
	temp = Buffer[Oldest];
	Oldest = (Oldest + 1) % N;
	Count = Count - 1;
	signalc(NotFull);
	return temp;
}

init {
	Count = 0; Oldest = 0; Newest = 0;
}

}

const	int Values = 20;

void Producer(int ID) {
	int I;
	for (I = 1; I < Values; I++) {
		cout << "Producer " << ID << " producing " << ID*100+I << '\\n';
		Append(ID*100+I);
	}
}

void Consumer(int ID) {
	int I, J;
	for (I = 1; I < Values; I++) {
		J = Take();
		cout << "Consumer " << ID << " consuming " << J << '\\n';
	}
}

void main() {
	cobegin {
		Producer(1); Consumer(1); //Consumer(2); Consumer(3);
	}
}` },
{ id: 'sm1', file: '07-contador-monitor-y-semaforo.cm', name: 'Monitor + semáforo · Contador (simple)', code:
`/*
  07-contador-monitor-y-semaforo.cm  (version simple)

  - MONITOR "Contador": dos procesos suman al mismo valor sin chocar,
    porque solo uno a la vez puede estar dentro del monitor.
  - SEMAFORO "listo" (empieza en 0): el jefe espera a que los dos
    trabajadores terminen antes de mostrar el resultado.

  Resultado esperado: siempre "Total: 6".
*/

semaphore listo;

monitor Contador {
  int valor;
  void sumar() { valor = valor + 1; }
  int leer() { return valor; }
  init { valor = 0; }
}

void trabajador(int id) {
  int i;
  for (i = 1; i <= 3; i++) sumar();
  cout << "Trabajador " << id << " termino." << endl;
  signal(listo);
}

void jefe() {
  wait(listo);
  wait(listo);
  cout << "Total: " << leer() << endl;
}

void main() {
  initialsem(listo, 0);
  cobegin { trabajador(1); trabajador(2); jefe(); }
}
` },
{ id: 'sm2', file: '06-cafeteria-semaforo-y-monitor.cm', name: 'Monitor + semáforo · Cafetería (mesas y pedidos)', code:
`/*
  06-cafeteria-semaforo-y-monitor.cm

  Una cafeteria con 2 mesas y 4 clientes. Hay un cocinero.

  - SEMAFORO "mesas" (empieza en 2): solo 2 clientes pueden estar
    sentados a la vez. El tercero y el cuarto esperan en wait(mesas).

  - MONITOR "Mostrador": guarda la cola de pedidos. Los clientes dejan
    su pedido con pedir(id) y el cocinero los saca con tomar().
    Si no hay pedidos, el cocinero espera en waitc(hayPedido).

  - SEMAFOROS "servido[i]" (empiezan en 0): el cliente i espera su plato
    con wait(servido[i]) y el cocinero se lo entrega con signal(servido[i]).

  Que observar en Mini BACI / jBACI:
  - Semaforos: "mesas" baja a 0 y los otros clientes quedan esperando.
  - Monitores: el cocinero en la cola de "hayPedido" cuando no hay pedidos,
    y la variable Mostrador.pedidos subiendo y bajando (nunca pasa de 4).
*/

const int CLIENTES = 4;

semaphore mesas;
semaphore servido[CLIENTES];

monitor Mostrador {
  int cola[CLIENTES];
  int ini, fin, pedidos;
  condition hayPedido;

  void pedir(int id) {
    cola[fin] = id;
    fin = (fin + 1) % CLIENTES;
    pedidos = pedidos + 1;
    signalc(hayPedido);
  }

  int tomar() {
    int id;
    if (pedidos == 0) waitc(hayPedido);
    id = cola[ini];
    ini = (ini + 1) % CLIENTES;
    pedidos = pedidos - 1;
    return id;
  }

  init { ini = 0; fin = 0; pedidos = 0; }
}

void cliente(int id) {
  wait(mesas);
  cout << "Cliente " << id << " se sienta y pide." << endl;
  pedir(id);
  wait(servido[id]);
  cout << "Cliente " << id << " come y deja la mesa." << endl;
  signal(mesas);
}

void cocinero() {
  int i, id;
  for (i = 1; i <= CLIENTES; i++) {
    id = tomar();
    cout << "Cocinero prepara el pedido del cliente " << id << endl;
    signal(servido[id]);
  }
}

void main() {
  int i;
  initialsem(mesas, 2);
  for (i = 0; i < CLIENTES; i++) initialsem(servido[i], 0);
  cobegin {
    cliente(0); cliente(1); cliente(2); cliente(3); cocinero();
  }
  cout << "Cafeteria cerrada." << endl;
}
` },
{ id: 'm4', file: 'mon-sem.cm', name: 'Monitor · Semáforo hecho con monitor (mon-sem.cm)', code:
`/* Monitor implementation of semaphore. */
monitor monSemaphore {
	int semvalue;
	condition notbusy;

	void monP() {
	if (!semvalue)
		waitc(notbusy);
	else
		semvalue--;
		}
		
	void monV() {
		if (empty(notbusy))
			semvalue++;
		else
			signalc(notbusy);
	}
	
	init{ semvalue = 1; } 
} // end of monSemaphore monitor

int n;

void inc(int i) {
  monP();
  n = n + 1;
  monV();
}

void main() {
  cobegin {
  inc(1); inc(2);
  }
}

` },
{ id: 'n1', file: 'notas-cin.cm', name: 'jBACI · Notas con cin (grades.cm)', code:
`/*
 Concurrent input and calculation of grades. 
 Program needs synchronization for both critical section and order of execution. 
 From a Pascal program written by Yifat Ben-David Kolikant.
*/
int GradeA, GradeB, Final;

int Max(int X, int Y, int Z) {
  if ((X>Y) && (X>Z)) return X;
  else if ((Z>Y) && (Z>X)) return Z;
  else return Y;
}

void First() {
  int A, B, C;
  cout << "Enter grade of first semester:\\n";
  cin >> A;
  cin >> B;
  cin >> C;
  GradeA = Max(A, B, C);
  cout << "The grades were: " << A << ' ' << B << ' ' << C << '\\n';
}

void Second() {
  int D, E, F;
  cout << "Enter grade of second semester:\\n";
  cin >> D;
  cin >> E;
  cin >> F;
  GradeB = Max(D, E, F);
  cout << "The grades were: " << D << ' ' << E << ' ' << F << '\\n';
}

void Average() {
  Final = (GradeA + GradeB) / 2;
  cout << "The final grade is :" << Final << '\\n';
}

void main() {
  parbegin {
    First(); Second(); Average();
  }
}

` },
{ id: 'n2', file: 'graph.cm', name: 'jBACI · Gráficos (graph.cm)', code:
`// Demonstate jBACI graphics; fragment of alien program.
#include "gdefs.cm"
const
	int ALIENHEAD = 1;	int ALIENBODY = 2;
	int MISSILEHEAD = 3; 	int MISSILEBODY = 4;

        binarysem s = 1;

	void MoveAlien() {
		int i;
		for (i = 1; i < 40; i++) {
			wait(s);
			moveby(ALIENHEAD, 10, 0);
			moveby(ALIENBODY, 10, 0);
			signal(s);
		}
	}

	void Shoot() {
		int i;
		for (i = 1; i < 40; i++) {
			wait(s);
			moveby(MISSILEHEAD, 0, -11);
			moveby(MISSILEBODY, 0, -11);
			signal(s); 
		}
	}

void main() {
	create(ALIENBODY,   RECTANGLE, RED,   30, 50,  30, 30);
	create(ALIENHEAD,   CIRCLE,    RED,   60, 50,  30, 30);
	create(MISSILEBODY, RECTANGLE, BLUE, 400, 400, 30, 50);
	create(MISSILEHEAD, TRIANGLE,  BLUE, 415, 370, 30, 30);
	cobegin {
		Shoot();
		MoveAlien();
	}
}
` },
{ id: 'n3', file: 'lintest.cm', name: 'jBACI · Linda paso a paso (lintest.cm)', code:
`/* Test of Linda primitives */
/* Follow numbered instructions carefully! */

void p1() {
	char c; 
	int i1, i2; 
  /* 1. Step process p1 until **** */

  /* Check post-, read- and remove-note */
  postnote('m', 10, 20);
  readnote('m', i1, i2);
  cout << i1 << ' ' << i2 << '\\n';
  removenote('m', i1, i2);
  cout << i1 << ' ' << i2 << '\\n';

  /* Check different size notes */
  postnote('a');
  readnote('a');
  readnote('a', i1, i2);  /* OK, parameters are not counted */
  cout << i1 << ' ' << i2 << '\\n';
  removenote('a');
  postnote('b', 7);
  removenote('b', i1);
  cout << i1;
  
  /* Check values vs. variables */
  
  postnote('c', 1, 2);
  c = 'd'; i1 = 8; i2 = 9;
  postnote(c, i1, i2);
  readnote('c', i1, i2);
  cout << i1 << ' ' << i2 << '\\n';
  readnote(c, i1, i2);
  cout << i1 << ' ' << i2 << '\\n';
  removenote('c', i1, i2);
  cout << i1 << ' ' << i2 << '\\n';
  removenote(c, i1, i2);
  cout << i1 << ' ' << i2 << '\\n';
  
  /* Check blocking/unblocking */
  
  readnote('a', i1, i2);  /* **** */

  /* 5. Step p1 until ++++ */
  cout << i1 << ' ' << i2 << '\\n';
  removenote('a', i1, i2);
  removenote('b', i1, i2);

  /* Check read/remove with EQ */

  postnote('x', 11, 22);
  postnote('y', 33, 44);
  i1 = 111; i2 = 222;
  readnoteeq('x', i1, i2); /* ++++ */

  /* 7. Step p1 until ==== */
  cout << i1 << ' ' << i2 << '\\n';
  removenoteeq('x', i1, i2);  
  cout << i1 << ' ' << i2 << '\\n';
  removenote('x', i1, i2);

  i1 = 333; i2 = 444;
  removenoteeq('y', i1, i2); /* ==== */
  cout << i1 << ' ' << i2 << '\\n';
  removenote('y', i1, i2);
}

void p2() {
  /* 2. Step this instruction after p1 blocks */ 
  postnote('b', 55, 66);
  
  /* 3. Step p1 again to make sure that it blocks again */
  
  /* 4. Step this instruction to unblock p1 */
  postnote('a', 77, 88);
  
  /* 6. Step this instruction after p1 blocks */
  postnote('x', 111, 222);

  /* 8. Step this instruction to unblock p1 */
  postnote('y', 333, 444);
}

void main() {
  cobegin { p1(); p2(); }
}

` },
{ id: 'n4', file: 'incremen.cm', name: 'Manual BACI · incremen.cm (char y carreras)', code:
`const int m = 5;
int n;

void incr(char id)
{
    int i;

    for(i = 1; i <= m; i = i + 1)
    {
        n = n + 1;
        cout << id << " n =" << n << " i =";
        cout << i << " " << id << endl;
    }
}

main()
{
    n = 0;
    cobegin
    {
        incr('A'); incr('B'); incr('C');
    }
    cout << "The sum is " << n << endl;
}
` },
{ id: 'n5', file: 'test-and-set.cm', name: 'Manual BACI · test_and_set con atomic', code:
`atomic int test_and_set(int& target) {
    int u;
    u = target;
    target = 1;
    return u;
}

int lock = 0;

void proc(int id) {
    int i = 0;
    while (i < 10) {
        while (test_and_set(lock)) /* wait */ ;
        cout << id;
        lock = 0;
        i++;
    }
}

main() {
    cobegin { proc(1); proc(2); proc(3); }
    cout << endl;
}
` },
{ id: 'n6', file: 'filosofos.cm', name: 'Filósofos con arreglo de semáforos', code:
`/*
 Cena de los filosofos: 5 filosofos y 5 tenedores.
 Cada tenedor es un binarysem dentro de un arreglo.
 Para evitar el deadlock, el filosofo 4 toma los tenedores
 en el orden contrario.
*/
const int N = 5;
binarysem tenedor[N];
binarysem pantalla = 1;

void filosofo(int i) {
    int vuelta, izq, der, aux;
    izq = i;
    der = (i + 1) % N;
    if (i == N - 1) { aux = izq; izq = der; der = aux; }
    for (vuelta = 1; vuelta <= 2; vuelta++) {
        wait(tenedor[izq]);
        wait(tenedor[der]);
        wait(pantalla);
        cout << "Filosofo " << i << " come (vuelta " << vuelta << ")" << endl;
        signal(pantalla);
        signal(tenedor[der]);
        signal(tenedor[izq]);
    }
}

void main() {
    int i;
    for (i = 0; i < N; i++) initialsem(tenedor[i], 1);
    cobegin {
        filosofo(0); filosofo(1); filosofo(2); filosofo(3); filosofo(4);
    }
    cout << "Todos comieron." << endl;
}
` },
{ id: 'n7', file: 'strings.cm', name: 'Strings: sprintf, sscanf, stringCompare', code:
`/* Ejemplos de la seccion 4 del manual de BACI C-- */
string[80] x;
string[15] y, z;
string[50] a, b;
int i, j, k;

void main() {
    stringCopy(y, "alongstring");
    stringCopy(z, "a long string");
    sprintf(x, ".%12d. .%-20s. .%q. .%08X.", 202, y, z, 0x3c03);
    cout << x << endl;

    stringCopy(a, "202 alongstring 3c03 \\"a long string\\"");
    i = sscanf(a, "%d %s %x %q", j, a, k, b);
    cout << "sscanf leyo " << i << " datos: " << j << " | " << a << " | " << k << " | " << b << endl;

    cout << "stringCompare(\\"abc\\", \\"abd\\") = " << stringCompare("abc", "abd") << endl;
    stringConcat(y, "!!");
    cout << y << " tiene " << stringLength(y) << " letras" << endl;
}
` },
{ id: 'n8', file: 'switch-y-funciones.cm', name: 'switch, typedef y recursión', code:
`typedef int fila[3];
fila tabla[2];

int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}

void nombre(int dia) {
    switch (dia) {
        case 1: cout << "lunes"; break;
        case 2: cout << "martes"; break;
        case 6:
        case 7: cout << "fin de semana"; break;
        default: cout << "otro dia";
    }
    cout << endl;
}

void main() {
    int i, j;
    for (i = 0; i < 2; i++)
        for (j = 0; j < 3; j++)
            tabla[i][j] = fact(i + j + 1);
    for (i = 0; i < 2; i++) {
        for (j = 0; j < 3; j++) cout << tabla[i][j] << " ";
        cout << endl;
    }
    nombre(2); nombre(7); nombre(4);
    cout << (fact(5) > 100 ? "5! es grande" : "5! es chico") << endl;
}
` },
{ id: 'n9', file: 'linda-productor-consumidor.cm', name: 'Linda · productor y consumidor', code:
`/*
 Productor-consumidor con Linda: el productor deja notas ('d', n)
 en la pizarra y el consumidor las saca. Al final el productor
 deja la nota ('f') para avisar que termino.
*/
void productor() {
    int n;
    for (n = 1; n <= 5; n++) {
        postnote('d', n);
        cout << "Productor deja " << n << endl;
    }
    postnote('f');
}

void consumidor() {
    int v, suma;
    suma = 0;
    readnote('f');                 /* espera a que el productor termine */
    for (v = 1; v <= 5; v++) {
        removenote('d', v=);       /* saca exactamente la nota ('d', v) */
        suma = suma + v;
    }
    cout << "Consumidor sumo " << suma << endl;
}

void main() {
    cobegin { productor(); consumidor(); }
}
` },
{ id: 'n10', file: 'suspend-revive.cm', name: 'suspend, revive y which_proc', code:
`/*
 El proceso 1 se duerme con suspend() y el proceso 2 lo despierta con revive(1).
 dormir() es atomic: marca "listo" y se suspende sin que otro proceso se meta
 entre medio. Sin atomic, el revive podria llegar ANTES del suspend y el
 proceso 1 dormiria para siempre (un "despertar perdido").
*/
int listo = 0;

atomic void dormir() {
    listo = 1;
    suspend();
}

void dormilon() {
    cout << "Soy el proceso " << which_proc() << " y me duermo." << endl;
    dormir();
    cout << "Proceso " << which_proc() << ": me despertaron." << endl;
}

void despertador() {
    while (!listo) ;
    cout << "Soy el proceso " << which_proc() << " y despierto al 1." << endl;
    revive(1);
}

void main() {
    cobegin { dormilon(); despertador(); }
}
` },
];

const INCLUDES = {
  'gdefs.cm': `// Constants for jBACI graphcs
const
   int RED   = 1; int BLACK   = 2; int BLUE  = 3; int YELLOW = 4;
   int GREEN = 5; int MAGENTA = 6; int WHITE = 7;
   int CIRCLE = 1; int LINE = 2; int RECTANGLE = 3; int TRIANGLE = 4;

`,
  'iodefs.cm': `// Function for non-blocking input of character value
const	char cflag = '\\r';
char getChar() {
	char d = cflag; 
	while (d == cflag) nbcin >> d;
	return d;
}

// Function for non-blocking input of integer value
const int iflag = -32767;
int getNum() {
	int i = iflag;
	while (i == iflag) nbcin >> i;
	return i;
}


`,
};

if (typeof module !== 'undefined' && module.exports) module.exports = { EJEMPLOS, INCLUDES };
else { root.EJEMPLOS = EJEMPLOS; root.BACI_INCLUDES = INCLUDES; }
})(typeof window !== 'undefined' ? window : globalThis);

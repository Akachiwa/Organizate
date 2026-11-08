// Organízate: lógica de la página.
// Pide los datos a la API (/api/...), que Nginx reenvía al contenedor "app".

const API = "/api";
const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const COLORES = ["#7c3aed", "#db2777", "#ea580c", "#059669", "#0284c7", "#ca8a04", "#e11d48", "#4f46e5"];
const ICONO_TIPO = { clase: "🎓", trabajo: "💼", personal: "🌿", estudio: "📚" };

const datos = { horario: [], tareas: [], sesiones: [], sesiones_hoy: [], racha: 0 };
const vista = { semana: 0 };   // 0 = esta semana, 1 = la siguiente, -1 = la anterior
const prefs = leerPrefs();
const $ = (id) => document.getElementById(id);

// ================= Utilidades =================

async function pedir(ruta, opciones = {}) {
  const resp = await fetch(API + ruta, { headers: { "Content-Type": "application/json" }, ...opciones });
  if (resp.status === 204) return null;
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || "Error " + resp.status);
  return json;
}

const dos = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const sumarDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const leerFecha = (t) => { const [a, m, d] = t.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
const diaSemana = (d) => (d.getDay() + 6) % 7;            // 0 = lunes
const lunes = (d) => sumarDias(d, -diaSemana(d));        // primer día de la semana de d
const inicioVista = () => sumarDias(lunes(hoy()), vista.semana * 7);
const minutoActual = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hora = (m) => `${Math.floor(m / 60)}:${dos(m % 60)}`;
const aMinutos = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const horas = (min) => { const h = Math.round(min / 6) / 10; return (Number.isInteger(h) ? h : h.toFixed(1)) + " h"; };

function colorMateria(nombre) {
  let n = 0;
  for (const c of nombre) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES[n % COLORES.length];
}

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function aviso(texto, tipo = "") {
  const t = crear("div", "toast " + tipo, texto);
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), tipo ? 7000 : 3500);
}

function confeti(cantidad = 80) {
  for (let i = 0; i < cantidad; i++) {
    const c = crear("i", "confeti");
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = COLORES[i % COLORES.length];
    c.style.setProperty("--x", (Math.random() * 200 - 100) + "px");
    c.style.setProperty("--r", (Math.random() * 720) + "deg");
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
    c.style.animationDelay = Math.random() * 0.3 + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}

function leerPrefs() {
  try { return { desde: 8, hasta: 22, max: 4, ...JSON.parse(localStorage.getItem("organizate-prefs") || "{}") }; }
  catch { return { desde: 8, hasta: 22, max: 4 }; }
}
function guardarPrefs() {
  try { localStorage.setItem("organizate-prefs", JSON.stringify(prefs)); } catch { /* sin almacenamiento */ }
}

// Todo lo que pasa hoy: bloques fijos del día + sesiones de estudio de hoy
function eventosDeHoy() {
  const d = hoy();
  const fijos = datos.horario.filter((b) => b.dia === diaSemana(d))
    .map((b) => ({ ...b, nombre: b.titulo }));
  const estudio = datos.sesiones_hoy
    .map((s) => ({ ...s, tipo: "estudio", nombre: "Estudiar: " + s.titulo }));
  return [...fijos, ...estudio].sort((a, b) => a.inicio - b.inicio);
}

// ================= Dibujar =================

function dibujarTodo() {
  dibujarResumen();
  dibujarAhora();
  dibujarCalendario();
  dibujarTareas();
  dibujarPorMateria();
}

function dibujarResumen() {
  const fijos = datos.horario.reduce((s, b) => s + b.fin - b.inicio, 0);
  const estudio = datos.sesiones.reduce((s, x) => s + x.fin - x.inicio, 0);
  const hecho = datos.sesiones.filter((x) => x.hecha).reduce((s, x) => s + x.fin - x.inicio, 0);

  // Tiempo libre: horas disponibles de cada día menos clases y estudio dentro de ese rango
  const a = prefs.desde * 60, b = prefs.hasta * 60;
  const dentro = (i, f) => Math.max(0, Math.min(f, b) - Math.max(i, a));
  const libre = 7 * (b - a) - datos.horario.reduce((s, x) => s + dentro(x.inicio, x.fin), 0) - estudio;

  $("dClases").textContent = horas(fijos);
  $("dEstudio").textContent = horas(estudio);
  $("dLibre").textContent = horas(Math.max(0, libre));
  $("dPend").textContent = datos.tareas.filter((t) => !t.completada).length;
  $("dRacha").textContent = datos.racha + (datos.racha === 1 ? " día" : " días");

  const pct = estudio ? Math.round((hecho / estudio) * 100) : 0;
  $("pctSemana").textContent = pct + "%";
  $("anilloValor").style.strokeDashoffset = 314.16 * (1 - pct / 100);
}

function dibujarAhora() {
  const ahora = minutoActual();
  const eventos = eventosDeHoy();
  const actual = eventos.find((e) => e.inicio <= ahora && ahora < e.fin);
  const siguiente = eventos.find((e) => e.inicio > ahora);

  if (actual) {
    $("ahoraEtiqueta").textContent = "Ahora · " + ICONO_TIPO[actual.tipo] + " " + actual.tipo;
    $("ahoraTitulo").textContent = actual.nombre;
    $("ahoraDetalle").textContent = `Termina a las ${hora(actual.fin)} (faltan ${actual.fin - ahora} min)` +
      (siguiente ? ` · Después: ${siguiente.nombre}` : "");
  } else if (siguiente) {
    const falta = siguiente.inicio - ahora;
    $("ahoraEtiqueta").textContent = "Tiempo libre";
    $("ahoraTitulo").textContent = "Siguiente: " + siguiente.nombre;
    $("ahoraDetalle").textContent = `A las ${hora(siguiente.inicio)} · en ${falta >= 60 ? Math.floor(falta / 60) + " h " : ""}${falta % 60} min`;
  } else {
    $("ahoraEtiqueta").textContent = "Día libre";
    $("ahoraTitulo").textContent = eventos.length ? "Terminaste lo de hoy 🎉" : "Hoy no tienes nada agendado";
    $("ahoraDetalle").textContent = "Descansa o adelanta un pendiente.";
  }

  const chips = $("diaChips");
  chips.replaceChildren();
  eventos.forEach((e) => {
    const estado = e.fin <= ahora ? " pasado" : e === actual ? " actual" : "";
    const chip = crear("div", "chip" + estado);
    chip.appendChild(crear("b", "", ICONO_TIPO[e.tipo] + " " + e.nombre));
    chip.appendChild(document.createTextNode(`${hora(e.inicio)} – ${hora(e.fin)}`));
    chips.appendChild(chip);
  });
  if (!eventos.length) chips.appendChild(crear("div", "chip", "Sin eventos hoy"));
}

function dibujarCalendario() {
  const cal = $("calendario");
  cal.replaceChildren();
  const alto = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hora"));
  const todos = [...datos.horario, ...datos.sesiones];
  const h0 = Math.min(7, prefs.desde, ...todos.map((b) => Math.floor(b.inicio / 60)));
  const h1 = Math.max(22, prefs.hasta, ...todos.map((b) => Math.ceil(b.fin / 60)));
  const y = (min) => ((min - h0 * 60) / 60) * alto;
  const inicio = inicioVista();
  const hoyIso = iso(hoy());
  const estado = (d) => (iso(d) === hoyIso ? " hoy" : d < hoy() ? " pasado" : "");
  dibujarNavegacion(inicio);

  // Encabezados
  cal.appendChild(crear("div"));
  for (let i = 0; i < 7; i++) {
    const d = sumarDias(inicio, i);
    const cab = crear("div", "cal-cab" + estado(d));
    cab.appendChild(document.createTextNode(iso(d) === hoyIso ? "Hoy" : DIAS_CORTOS[i]));
    cab.appendChild(crear("b", "", d.getDate()));
    cal.appendChild(cab);
  }

  // Columna de horas
  const columnaHoras = crear("div", "cal-horas");
  columnaHoras.style.height = (h1 - h0) * alto + "px";
  for (let h = h0 + 1; h < h1; h++) {
    const s = crear("span", "", h + ":00");
    s.style.top = (h - h0) * alto + "px";
    columnaHoras.appendChild(s);
  }
  cal.appendChild(columnaHoras);

  // Un día por columna
  let retraso = 0;
  for (let i = 0; i < 7; i++) {
    const d = sumarDias(inicio, i);
    const col = crear("div", "cal-dia" + estado(d));
    col.style.height = (h1 - h0) * alto + "px";
    col.title = "Toca para agregar a tu horario";
    col.addEventListener("click", (ev) => {
      if (ev.target !== col) return;
      abrirNuevoBloque(diaSemana(d), h0 + Math.floor(ev.offsetY / alto));
    });

    const ponerBloque = (b, clase, titulo, color) => {
      const el = crear("button", "bloque " + clase);
      el.type = "button";
      el.style.top = y(b.inicio) + "px";
      el.style.height = Math.max(18, y(b.fin) - y(b.inicio) - 2) + "px";
      el.style.animationDelay = (retraso++ * 18) + "ms";
      if (color) el.style.setProperty("--c", color);
      el.appendChild(crear("b", "", titulo));
      el.appendChild(crear("small", "", `${hora(b.inicio)} – ${hora(b.fin)}`));
      el.addEventListener("click", () => abrirDetalle(b, clase));
      col.appendChild(el);
    };

    datos.horario.filter((b) => b.dia === diaSemana(d)).forEach((b) => ponerBloque(b, b.tipo, b.titulo));
    datos.sesiones.filter((s) => s.fecha === iso(d)).forEach((s) =>
      ponerBloque(s, "estudio" + (s.hecha ? " hecha" : ""), s.titulo, colorMateria(s.materia)));

    if (iso(d) === hoyIso) {
      const ahora = minutoActual();
      if (ahora >= h0 * 60 && ahora <= h1 * 60) {
        const linea = crear("div", "linea-ahora");
        linea.style.top = y(ahora) + "px";
        col.appendChild(linea);
      }
    }
    cal.appendChild(col);
  }
}

function dibujarNavegacion(inicio) {
  const fin = sumarDias(inicio, 6);
  const mes = (d) => d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
  $("rangoSemana").textContent = inicio.getMonth() === fin.getMonth()
    ? `${inicio.getDate()} – ${fin.getDate()} ${mes(fin)}`
    : `${inicio.getDate()} ${mes(inicio)} – ${fin.getDate()} ${mes(fin)}`;
  const n = vista.semana;
  $("tituloSemana").textContent = n === 0 ? "Esta semana" : n === 1 ? "Próxima semana" : n === -1 ? "Semana pasada"
    : n > 0 ? `En ${n} semanas` : `Hace ${-n} semanas`;
  $("btnHoy").hidden = n === 0;
}

function cambiarSemana(paso) {
  vista.semana = paso === 0 ? 0 : vista.semana + paso;
  recargar();
}

function dibujarPorMateria() {
  const porMateria = {};
  datos.sesiones.forEach((s) => {
    const m = (porMateria[s.materia] ??= { hecho: 0, plan: 0 });
    if (s.hecha) m.hecho += s.fin - s.inicio; else m.plan += s.fin - s.inicio;
  });
  const filas = Object.entries(porMateria).sort((a, b) => (b[1].hecho + b[1].plan) - (a[1].hecho + a[1].plan));
  const mayor = Math.max(1, ...filas.map(([, v]) => v.hecho + v.plan));
  const cont = $("barrasMateria");
  cont.replaceChildren();
  if (!filas.length) {
    cont.appendChild(crear("p", "vacio", "Sin sesiones de estudio en esta semana."));
    return;
  }
  filas.forEach(([materia, v]) => {
    const fila = crear("div", "fila-materia");
    fila.style.setProperty("--c", colorMateria(materia));
    fila.appendChild(crear("span", "nombre", materia));
    fila.appendChild(crear("span", "cuanto", `${horas(v.hecho)} de ${horas(v.hecho + v.plan)}`));
    const barra = crear("div", "barra");
    const bh = crear("i", "b-hecha"); bh.style.width = (v.hecho / mayor) * 100 + "%";
    const bp = crear("i", "b-plan"); bp.style.width = (v.plan / mayor) * 100 + "%";
    barra.append(bh, bp);
    fila.appendChild(barra);
    cont.appendChild(fila);
  });
}

function etiquetaEntrega(t) {
  if (!t.fecha_entrega) return { texto: "Sin fecha", clase: "" };
  const dias = Math.round((leerFecha(t.fecha_entrega) - hoy()) / 86400000);
  if (t.completada) return { texto: "Entregada", clase: "" };
  if (dias < 0) return { texto: `Venció hace ${-dias} d`, clase: "vencida" };
  if (dias === 0) return { texto: "Entrega hoy", clase: "vencida" };
  if (dias === 1) return { texto: "Entrega mañana", clase: "urgente" };
  return { texto: `Entrega en ${dias} días`, clase: dias <= 3 ? "urgente" : "" };
}

function dibujarTareas() {
  const ul = $("listaTareas");
  ul.replaceChildren();
  const materias = new Set();

  datos.tareas.forEach((t) => {
    materias.add(t.materia);
    const color = colorMateria(t.materia);
    const li = crear("li", "tarea" + (t.completada ? " hecha" : ""));
    li.style.setProperty("--c", color);

    const check = crear("button", "check", t.completada ? "✓" : "");
    check.type = "button";
    check.setAttribute("aria-label", t.completada ? "Marcar como pendiente" : "Marcar como entregada");
    check.addEventListener("click", () => completarTarea(t));

    const cuerpo = crear("div");
    cuerpo.appendChild(crear("div", "t-titulo", t.titulo));
    const meta = crear("div", "t-meta");
    meta.appendChild(crear("span", "mat", t.materia));
    const e = etiquetaEntrega(t);
    meta.appendChild(crear("span", e.clase, e.texto));
    meta.appendChild(crear("span", "", "Prioridad " + t.prioridad));
    cuerpo.appendChild(meta);

    if (!t.completada) {
      const total = t.horas_estimadas;
      const barra = crear("div", "barra");
      const bh = crear("i", "b-hecha"); bh.style.width = Math.min(100, (t.horas_hechas / total) * 100) + "%";
      const bp = crear("i", "b-plan"); bp.style.width = Math.min(100, (t.horas_planeadas / total) * 100) + "%";
      barra.append(bh, bp);
      cuerpo.appendChild(barra);
      cuerpo.appendChild(crear("div", "t-horas",
        `${horas(t.horas_hechas * 60)} hechas de ${total} h · ${horas(t.horas_planeadas * 60)} en tu calendario`));
    }

    const borrar = crear("button", "borrar", "×");
    borrar.type = "button";
    borrar.setAttribute("aria-label", "Eliminar " + t.titulo);
    borrar.addEventListener("click", () => eliminarTarea(t));

    li.append(check, cuerpo, borrar);
    ul.appendChild(li);
  });

  $("sinTareas").hidden = datos.tareas.length > 0;
  $("listaMaterias").replaceChildren(...[...materias].map((m) => new Option(m)));
}

// ================= Acciones =================

async function recargar() {
  try {
    Object.assign(datos, await pedir(`/semana?hoy=${iso(hoy())}&inicio=${iso(inicioVista())}`));
    dibujarTodo();
    revisarSistema();
  } catch (e) {
    aviso("No se pudieron cargar tus datos: " + e.message, "aviso");
  }
}

async function organizar() {
  const boton = $("btnPlanear");
  boton.classList.add("cargando");
  boton.disabled = true;
  try {
    const r = await pedir("/planificar", {
      method: "POST",
      body: JSON.stringify({
        hoy: iso(hoy()), minuto_actual: minutoActual(),
        desde: prefs.desde, hasta: prefs.hasta, max_horas: prefs.max,
      }),
    });
    vista.semana = 0;
    await recargar();
    if (r.horas_planeadas) {
      aviso(`✦ Listo: repartimos ${r.horas_planeadas} h de estudio en ${r.sesiones_creadas} sesiones.`);
      const finSemana = sumarDias(lunes(hoy()), 6);
      if (r.ultima_fecha && leerFecha(r.ultima_fecha) > finSemana) {
        const hasta = leerFecha(r.ultima_fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
        aviso(`📅 También hay sesiones en las próximas semanas (hasta el ${hasta}). Usa › para verlas.`);
      }
      confeti(60);
    } else {
      aviso("No hay horas que repartir: agrega pendientes o amplía tu horario de estudio.");
    }
    r.avisos.forEach((a) => aviso("⚠ " + a, "aviso"));
  } catch (e) {
    aviso(e.message, "aviso");
  } finally {
    boton.classList.remove("cargando");
    boton.disabled = false;
  }
}

async function guardarTarea(ev) {
  ev.preventDefault();
  const form = ev.target;
  try {
    await pedir("/tareas", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    $("oHoras").textContent = "2 h";
    aviso("Pendiente guardado. Presiona «Organizar mi semana» para darle lugar en tu calendario.");
    await recargar();
  } catch (e) {
    aviso(e.message, "aviso");
  }
}

async function completarTarea(t) {
  try {
    await pedir("/tareas/" + t.id, { method: "PATCH", body: JSON.stringify({ completada: !t.completada }) });
    if (!t.completada) { confeti(); aviso("¡Pendiente entregado! 🎉"); }
    await recargar();
  } catch (e) { aviso(e.message, "aviso"); }
}

async function eliminarTarea(t) {
  if (!confirm(`¿Eliminar «${t.titulo}» y sus sesiones de estudio?`)) return;
  try {
    await pedir("/tareas/" + t.id, { method: "DELETE" });
    await recargar();
  } catch (e) { aviso(e.message, "aviso"); }
}

// ----- Ventana: nuevo bloque del horario -----

function abrirNuevoBloque(dia, horaInicio) {
  const form = $("formBloque");
  form.reset();
  form.dia.value = dia;
  form.inicio.value = `${dos(horaInicio)}:00`;
  form.fin.value = `${dos(Math.min(horaInicio + 1, 23))}:${horaInicio + 1 > 23 ? "59" : "00"}`;
  $("errBloque").textContent = "";
  $("dlgBloque").showModal();
  form.titulo.focus();
}

async function guardarBloque(ev) {
  ev.preventDefault();
  const f = ev.target;
  try {
    await pedir("/horario", {
      method: "POST",
      body: JSON.stringify({
        titulo: f.titulo.value, tipo: f.tipo.value, dia: Number(f.dia.value),
        inicio: aMinutos(f.inicio.value), fin: aMinutos(f.fin.value),
      }),
    });
    $("dlgBloque").close();
    aviso("Agregado a tu horario. Vuelve a organizar tu semana para acomodar el estudio.");
    await recargar();
  } catch (e) {
    $("errBloque").textContent = e.message;
  }
}

// ----- Ventana: detalle de un bloque -----

function abrirDetalle(b, clase) {
  const esEstudio = clase.startsWith("estudio");
  $("detTipo").textContent = esEstudio ? "📚 Sesión de estudio" : ICONO_TIPO[b.tipo] + " " + b.tipo;
  $("detTitulo").textContent = b.titulo;
  $("detHora").textContent = esEstudio
    ? `${b.materia} · ${leerFecha(b.fecha).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })} · ${hora(b.inicio)} – ${hora(b.fin)}`
    : `Cada ${DIAS[b.dia].toLowerCase()} · ${hora(b.inicio)} – ${hora(b.fin)}`;

  const acciones = $("detAcciones");
  acciones.replaceChildren();
  const boton = (texto, clase, accion) => {
    const btn = crear("button", clase, texto);
    btn.type = "button";
    btn.addEventListener("click", async () => {
      try { await accion(); $("dlgDetalle").close(); await recargar(); }
      catch (e) { aviso(e.message, "aviso"); }
    });
    acciones.appendChild(btn);
  };

  if (esEstudio) {
    boton("⏱ Enfocarme", "btn-sec", async () => abrirEnfoque(b.titulo, Math.min(50, b.fin - b.inicio)));
    boton(b.hecha ? "Desmarcar" : "✓ Ya la hice", "btn", async () => {
      await pedir("/sesiones/" + b.id, { method: "PATCH", body: JSON.stringify({ hecha: !b.hecha }) });
      if (!b.hecha) { confeti(40); aviso("¡Bien! Una sesión menos 💪"); }
    });
  } else {
    boton("Eliminar del horario", "btn-peligro", () => pedir("/horario/" + b.id, { method: "DELETE" }));
  }
  const cerrar = crear("button", "btn-sec", "Cerrar");
  cerrar.type = "button";
  cerrar.addEventListener("click", () => $("dlgDetalle").close());
  acciones.prepend(cerrar);
  $("dlgDetalle").showModal();
}

// ================= Modo enfoque =================

const reloj = { total: 25 * 60, restante: 25 * 60, intervalo: null };
const CIRCULO = 603.19;

function pintarReloj() {
  const m = Math.floor(reloj.restante / 60), s = reloj.restante % 60;
  $("relojTxt").textContent = `${dos(m)}:${dos(s)}`;
  $("relojValor").style.strokeDashoffset = CIRCULO * (1 - reloj.restante / reloj.total);
  document.title = reloj.intervalo ? `${dos(m)}:${dos(s)} · Organízate` : "Organízate · Planifica tu semana";
}

function ponerMinutos(min) {
  pausar();
  reloj.total = reloj.restante = min * 60;
  document.querySelectorAll(".enf-opciones button").forEach((b) => b.classList.toggle("on", Number(b.dataset.min) === min));
  pintarReloj();
}

function pausar() {
  clearInterval(reloj.intervalo);
  reloj.intervalo = null;
  $("btnPlay").textContent = "Continuar";
}

function alternarReloj() {
  if (reloj.intervalo) return pausar();
  if (reloj.restante === 0) reloj.restante = reloj.total;
  $("btnPlay").textContent = "Pausar";
  reloj.intervalo = setInterval(() => {
    reloj.restante--;
    pintarReloj();
    if (reloj.restante <= 0) {
      pausar();
      $("btnPlay").textContent = "Empezar";
      sonar();
      confeti();
      aviso("⏰ ¡Tiempo! Toma un descanso.");
    }
  }, 1000);
  pintarReloj();
}

function sonar() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15);
    });
  } catch { /* sin audio */ }
}

function abrirEnfoque(titulo, minutos = 25) {
  const actual = eventosDeHoy().find((e) => e.tipo === "estudio" && e.fin > minutoActual());
  const pendiente = datos.tareas.find((t) => !t.completada);
  $("enfTitulo").textContent = titulo || (actual ? actual.titulo : pendiente ? pendiente.titulo : "Concéntrate");
  ponerMinutos([25, 50, 5].includes(minutos) ? minutos : 25);
  $("btnPlay").textContent = "Empezar";
  $("enfoque").hidden = false;
}

// ================= Estado de los contenedores =================

function marcar(id, ok) {
  $(id).classList.toggle("ok-s", ok);
  $(id).classList.toggle("err-s", !ok);
}

async function revisarSistema() {
  marcar("nWeb", true); // si la página cargó, Nginx está funcionando
  try {
    const s = await (await fetch(API + "/salud")).json();
    marcar("nApi", true);
    $("apiHost").textContent = "Flask · contenedor " + s.contenedor_api;
    marcar("nDb", s.db === "ok");
    $("dbInfo").textContent = s.db === "ok"
      ? `MySQL ${s.mysql} · ${s.total_tareas} pendientes · ${s.total_sesiones} sesiones`
      : "MySQL · sin conexión";
  } catch {
    marcar("nApi", false);
    marcar("nDb", false);
    $("apiHost").textContent = "Flask · sin respuesta";
    $("dbInfo").textContent = "MySQL · desconocido";
  }
}

// ================= Inicio =================

function iniciar() {
  const h = new Date().getHours();
  const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  $("saludo").textContent = `${saludo} · ${new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}`;

  // Controles del planificador
  const rangos = [["rDesde", "oDesde", "desde", (v) => v + ":00"], ["rHasta", "oHasta", "hasta", (v) => v + ":00"], ["rMax", "oMax", "max", (v) => v + " h"]];
  rangos.forEach(([r, o, clave, formato]) => {
    $(r).value = prefs[clave];
    $(o).textContent = formato(prefs[clave]);
    $(r).addEventListener("input", () => {
      prefs[clave] = Number($(r).value);
      $(o).textContent = formato(prefs[clave]);
      guardarPrefs();
      dibujarResumen();
    });
  });
  $("btnPlanear").addEventListener("click", organizar);

  // Cambiar de semana: botones y flechas del teclado
  $("btnAnt").addEventListener("click", () => cambiarSemana(-1));
  $("btnSig").addEventListener("click", () => cambiarSemana(1));
  $("btnHoy").addEventListener("click", () => cambiarSemana(0));
  document.addEventListener("keydown", (e) => {
    const escribiendo = e.target.closest("input, textarea, select") || document.querySelector("dialog[open]") || !$("enfoque").hidden;
    if (escribiendo) return;
    if (e.key === "ArrowLeft") cambiarSemana(-1);
    if (e.key === "ArrowRight") cambiarSemana(1);
  });

  // Pendientes
  $("btnNuevaTarea").addEventListener("click", () => {
    const form = $("formTarea");
    form.hidden = !form.hidden;
    $("btnNuevaTarea").setAttribute("aria-expanded", String(!form.hidden));
    $("btnNuevaTarea").textContent = form.hidden ? "+ Nuevo" : "Cerrar";
    if (!form.hidden) { form.fecha_entrega.min = iso(hoy()); form.titulo.focus(); }
  });
  $("rHoras").addEventListener("input", (e) => ($("oHoras").textContent = e.target.value + " h"));
  $("formTarea").addEventListener("submit", guardarTarea);

  // Ventanas
  $("selDia").replaceChildren(...DIAS.map((d, i) => new Option(d, i)));
  $("formBloque").addEventListener("submit", guardarBloque);
  document.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // Modo enfoque
  $("btnEnfoque").addEventListener("click", () => abrirEnfoque());
  $("cerrarEnfoque").addEventListener("click", () => { pausar(); $("enfoque").hidden = true; pintarReloj(); });
  $("btnPlay").addEventListener("click", alternarReloj);
  $("btnReiniciar").addEventListener("click", () => { ponerMinutos(reloj.total / 60); $("btnPlay").textContent = "Empezar"; });
  document.querySelectorAll(".enf-opciones button").forEach((b) =>
    b.addEventListener("click", () => { ponerMinutos(Number(b.dataset.min)); $("btnPlay").textContent = "Empezar"; }));

  recargar().then(() => {
    if (!datos.sesiones.length && datos.tareas.some((t) => !t.completada)) {
      aviso("✦ Tip: presiona «Organizar mi semana» y mira cómo se acomodan tus horas de estudio.");
    }
  });
  setInterval(revisarSistema, 10000);

  // Enlaces al monitoreo: mismo equipo desde el que se abrió la página, otro puerto
  const base = `${location.protocol}//${location.hostname}`;
  $("linkGrafana").href = `${base}:3000`;
  $("linkPrometheus").href = `${base}:9090/targets`;
  setInterval(() => { dibujarAhora(); dibujarCalendario(); }, 60000);
}

iniciar();

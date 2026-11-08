"""API de Organízate: planificador semanal para estudiantes.

Guarda el horario fijo, los pendientes y las sesiones de estudio en MySQL,
y reparte automáticamente las horas de estudio en los huecos libres.
Todas las rutas empiezan con /api (Nginx las reenvía a este contenedor).
"""
import os
import socket
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

import pymysql
from flask import Flask, Response, jsonify, request

app = Flask(__name__)
app.json.ensure_ascii = False  # acentos legibles en el JSON

PRIORIDADES = ("alta", "media", "baja")
HORIZONTE_DIAS = 28   # el planificador acomoda estudio hasta 4 semanas adelante
TIPOS = ("clase", "trabajo", "personal")
ORDEN_PRIORIDAD = "CASE t.prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END"


# ---------- Base de datos ----------

def conectar():
    """Abre una conexión a MySQL con los datos de compose.yaml."""
    return pymysql.connect(
        host=os.getenv("DB_HOST", "db"),
        user=os.getenv("DB_USER", "organizate_user"),
        password=os.getenv("DB_PASSWORD", "organizate_pass"),
        database=os.getenv("DB_NAME", "organizate"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=5,
    )


def consultar(sql, params=(), uno=False):
    """Ejecuta SQL. SELECT devuelve filas; INSERT/UPDATE/DELETE devuelve el id insertado."""
    con = conectar()
    try:
        with con.cursor() as cur:
            cur.execute(sql, params)
            if sql.lstrip().upper().startswith("SELECT"):
                return cur.fetchone() if uno else cur.fetchall()
            return cur.lastrowid
    finally:
        con.close()


def a_json(fila):
    """Convierte fechas, decimales y booleanos de MySQL a valores que entiende JavaScript."""
    if fila is None:
        return None
    for clave, valor in fila.items():
        if isinstance(valor, (date, datetime)):
            fila[clave] = valor.isoformat()
        elif isinstance(valor, Decimal):
            fila[clave] = float(valor)
    for clave in ("completada", "hecha"):
        if clave in fila:
            fila[clave] = bool(fila[clave])
    return fila


def como_fecha(valor):
    """Acepta date o texto 'AAAA-MM-DD'."""
    if isinstance(valor, date):
        return valor
    return date.fromisoformat(str(valor)[:10])


def fecha_o_hoy(texto):
    try:
        return como_fecha(texto)
    except (TypeError, ValueError):
        return date.today()


def entero(valor, minimo, maximo, por_defecto):
    try:
        return max(minimo, min(maximo, int(valor)))
    except (TypeError, ValueError):
        return por_defecto


def error(mensaje, codigo=400):
    return jsonify(error=mensaje), codigo


@app.errorhandler(pymysql.err.OperationalError)
def sin_base_de_datos(e):
    return error("No se pudo conectar a la base de datos.", 503)


# ---------- Métricas para Prometheus ----------
# Prometheus visita /metrics cada 15 s (dentro de la red; Nginx no lo publica hacia fuera).
# El formato es texto simple: una línea por medición, con etiquetas entre llaves.

_candado = threading.Lock()
_peticiones = {}            # (ruta, método, código) -> cuántas van
_arranque = time.time()


@app.after_request
def contar_peticion(respuesta):
    ruta = request.url_rule.rule if request.url_rule else "desconocida"
    if ruta != "/metrics":
        clave = (ruta, request.method, str(respuesta.status_code))
        with _candado:
            _peticiones[clave] = _peticiones.get(clave, 0) + 1
    return respuesta


def _etiqueta(valor):
    return str(valor).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


@app.get("/metrics")
def metricas():
    lineas = [
        "# HELP organizate_peticiones_total Peticiones atendidas por la API.",
        "# TYPE organizate_peticiones_total counter",
    ]
    with _candado:
        for (ruta, metodo, codigo), n in sorted(_peticiones.items()):
            lineas.append(f'organizate_peticiones_total{{ruta="{_etiqueta(ruta)}",metodo="{metodo}",codigo="{codigo}"}} {n}')

    lineas += [
        "# HELP organizate_api_arranque_segundos Momento en que arrancó este contenedor (epoch).",
        "# TYPE organizate_api_arranque_segundos gauge",
        f'organizate_api_arranque_segundos{{contenedor="{socket.gethostname()}"}} {_arranque:.0f}',
    ]

    try:
        f = consultar("""SELECT
              (SELECT COUNT(*) FROM tareas WHERE completada = 0) AS pendientes,
              (SELECT COUNT(*) FROM horario) AS bloques,
              (SELECT COUNT(*) FROM sesiones WHERE hecha = 1) AS ses_hechas,
              (SELECT COUNT(*) FROM sesiones WHERE hecha = 0) AS ses_plan,
              (SELECT COALESCE(SUM(fin - inicio), 0) FROM sesiones WHERE hecha = 1) AS min_hechos,
              (SELECT COALESCE(SUM(fin - inicio), 0) FROM sesiones WHERE hecha = 0) AS min_plan""", uno=True)
        db_arriba = 1
    except pymysql.MySQLError:
        f, db_arriba = None, 0

    lineas += [
        "# HELP organizate_db_arriba 1 si la API puede consultar MySQL, 0 si no.",
        "# TYPE organizate_db_arriba gauge",
        f"organizate_db_arriba {db_arriba}",
    ]
    if f:
        lineas += [
            "# HELP organizate_pendientes Pendientes sin entregar.",
            "# TYPE organizate_pendientes gauge",
            f"organizate_pendientes {f['pendientes']}",
            "# HELP organizate_bloques_horario Bloques del horario fijo.",
            "# TYPE organizate_bloques_horario gauge",
            f"organizate_bloques_horario {f['bloques']}",
            "# HELP organizate_sesiones Sesiones de estudio guardadas.",
            "# TYPE organizate_sesiones gauge",
            f'organizate_sesiones{{estado="hecha"}} {f["ses_hechas"]}',
            f'organizate_sesiones{{estado="planeada"}} {f["ses_plan"]}',
            "# HELP organizate_horas_estudio Horas de estudio guardadas.",
            "# TYPE organizate_horas_estudio gauge",
            f'organizate_horas_estudio{{estado="hecha"}} {int(f["min_hechos"]) / 60}',
            f'organizate_horas_estudio{{estado="planeada"}} {int(f["min_plan"]) / 60}',
        ]
    return Response("\n".join(lineas) + "\n", mimetype="text/plain; version=0.0.4")


# ---------- Estado del sistema ----------

@app.get("/api/salud")
def salud():
    estado = {"api": "ok", "contenedor_api": socket.gethostname()}
    try:
        fila = consultar(
            "SELECT VERSION() AS version, (SELECT COUNT(*) FROM tareas) AS tareas, "
            "(SELECT COUNT(*) FROM sesiones) AS sesiones",
            uno=True,
        )
        estado.update(db="ok", mysql=fila["version"], total_tareas=fila["tareas"],
                      total_sesiones=fila["sesiones"])
        return jsonify(estado)
    except pymysql.MySQLError as e:
        estado.update(db="error", detalle=str(e))
        return jsonify(estado), 503


# ---------- Todo lo de la semana en una sola llamada ----------

@app.get("/api/semana")
def semana():
    """
    inicio = primer día de la semana que se quiere ver (la página manda el lunes).
    hoy    = la fecha real de hoy (para el panel "Ahora" y la racha).
    """
    hoy = fecha_o_hoy(request.args.get("hoy"))
    inicio = fecha_o_hoy(request.args.get("inicio") or hoy.isoformat())
    fin = inicio + timedelta(days=6)

    horario = consultar("SELECT * FROM horario ORDER BY dia, inicio")
    tareas = consultar(f"""
        SELECT t.*,
               COALESCE(SUM(CASE WHEN s.hecha = 1 THEN s.fin - s.inicio END), 0) / 60 AS horas_hechas,
               COALESCE(SUM(CASE WHEN s.hecha = 0 THEN s.fin - s.inicio END), 0) / 60 AS horas_planeadas
        FROM tareas t LEFT JOIN sesiones s ON s.tarea_id = t.id
        GROUP BY t.id
        ORDER BY t.completada, t.fecha_entrega IS NULL, t.fecha_entrega, {ORDEN_PRIORIDAD}, t.id""")
    sql_sesiones = """
        SELECT s.*, t.titulo, t.materia, t.prioridad
        FROM sesiones s JOIN tareas t ON t.id = s.tarea_id
        WHERE s.fecha BETWEEN %s AND %s
        ORDER BY s.fecha, s.inicio"""
    sesiones = consultar(sql_sesiones, (inicio.isoformat(), fin.isoformat()))
    sesiones_hoy = consultar(sql_sesiones, (hoy.isoformat(), hoy.isoformat()))

    return jsonify(
        inicio=inicio.isoformat(),
        horario=[a_json(h) for h in horario],
        tareas=[a_json(t) for t in tareas],
        sesiones=[a_json(s) for s in sesiones],
        sesiones_hoy=[a_json(s) for s in sesiones_hoy],
        racha=calcular_racha(hoy),
    )


def calcular_racha(hoy):
    """Días seguidos (hasta hoy) en los que se marcó al menos una sesión como hecha."""
    filas = consultar("SELECT DISTINCT fecha FROM sesiones WHERE hecha = 1 AND fecha <= %s",
                      (hoy.isoformat(),))
    fechas = {como_fecha(f["fecha"]) for f in filas}
    dia = hoy if hoy in fechas else hoy - timedelta(days=1)   # si hoy aún no estudias, la racha sigue viva
    racha = 0
    while dia in fechas:
        racha += 1
        dia -= timedelta(days=1)
    return racha


# ---------- Horario fijo ----------

@app.post("/api/horario")
def crear_bloque():
    d = request.get_json(silent=True) or {}
    titulo = str(d.get("titulo", "")).strip()[:100]
    tipo = d.get("tipo", "clase")
    dia = entero(d.get("dia"), -1, 7, -1)
    inicio = entero(d.get("inicio"), -1, 1440, -1)
    fin = entero(d.get("fin"), -1, 1440, -1)

    if not titulo:
        return error("Escribe un nombre para el bloque.")
    if tipo not in TIPOS:
        return error("El tipo debe ser clase, trabajo o personal.")
    if not 0 <= dia <= 6:
        return error("Elige un día de la semana.")
    if inicio < 0 or fin <= inicio:
        return error("La hora de fin debe ser después de la de inicio.")

    choque = consultar(
        "SELECT titulo FROM horario WHERE dia = %s AND inicio < %s AND fin > %s",
        (dia, fin, inicio), uno=True)
    if choque:
        return error(f"Se empalma con «{choque['titulo']}».", 409)

    nuevo = consultar("INSERT INTO horario (titulo, tipo, dia, inicio, fin) VALUES (%s, %s, %s, %s, %s)",
                      (titulo, tipo, dia, inicio, fin))
    return jsonify(a_json(consultar("SELECT * FROM horario WHERE id = %s", (nuevo,), uno=True))), 201


@app.delete("/api/horario/<int:bloque_id>")
def borrar_bloque(bloque_id):
    consultar("DELETE FROM horario WHERE id = %s", (bloque_id,))
    return "", 204


# ---------- Pendientes ----------

@app.post("/api/tareas")
def crear_tarea():
    d = request.get_json(silent=True) or {}
    titulo = str(d.get("titulo", "")).strip()[:150]
    materia = (str(d.get("materia") or "").strip() or "General")[:80]
    horas = entero(d.get("horas_estimadas"), 1, 20, 2)
    prioridad = d.get("prioridad") or "media"
    fecha = str(d.get("fecha_entrega") or "").strip() or None

    if not titulo:
        return error("Escribe qué tienes que hacer.")
    if prioridad not in PRIORIDADES:
        return error("La prioridad debe ser alta, media o baja.")
    if fecha:
        try:
            como_fecha(fecha)
        except ValueError:
            return error("La fecha debe tener el formato AAAA-MM-DD.")

    nuevo = consultar(
        "INSERT INTO tareas (titulo, materia, fecha_entrega, horas_estimadas, prioridad) "
        "VALUES (%s, %s, %s, %s, %s)", (titulo, materia, fecha, horas, prioridad))
    return jsonify(a_json(consultar("SELECT * FROM tareas WHERE id = %s", (nuevo,), uno=True))), 201


@app.patch("/api/tareas/<int:tarea_id>")
def actualizar_tarea(tarea_id):
    d = request.get_json(silent=True) or {}
    if "completada" not in d:
        return error("Solo se puede cambiar 'completada'.")
    completada = 1 if d["completada"] else 0
    consultar("UPDATE tareas SET completada = %s WHERE id = %s", (completada, tarea_id))
    if completada:
        # Ya no hace falta estudiar para ella: se quitan sus sesiones pendientes
        consultar("DELETE FROM sesiones WHERE tarea_id = %s AND hecha = 0", (tarea_id,))
    tarea = consultar("SELECT * FROM tareas WHERE id = %s", (tarea_id,), uno=True)
    if tarea is None:
        return error("La tarea no existe.", 404)
    return jsonify(a_json(tarea))


@app.delete("/api/tareas/<int:tarea_id>")
def borrar_tarea(tarea_id):
    consultar("DELETE FROM sesiones WHERE tarea_id = %s", (tarea_id,))
    consultar("DELETE FROM tareas WHERE id = %s", (tarea_id,))
    return "", 204


# ---------- Sesiones de estudio ----------

@app.patch("/api/sesiones/<int:sesion_id>")
def marcar_sesion(sesion_id):
    d = request.get_json(silent=True) or {}
    consultar("UPDATE sesiones SET hecha = %s WHERE id = %s", (1 if d.get("hecha") else 0, sesion_id))
    sesion = consultar("SELECT * FROM sesiones WHERE id = %s", (sesion_id,), uno=True)
    if sesion is None:
        return error("La sesión no existe.", 404)
    return jsonify(a_json(sesion))


# ---------- El planificador: reparte las horas de estudio ----------

@app.post("/api/planificar")
def planificar():
    """
    1. Borra las sesiones que no se han hecho (se vuelven a planear).
    2. Busca huecos libres de 1 hora desde hoy hasta la entrega más lejana
       (mínimo 7 días, máximo 4 semanas), entre 'desde' y 'hasta',
       que no choquen con el horario fijo ni con sesiones ya hechas.
    3. Ordena los pendientes por fecha de entrega y prioridad. A cada uno, en ese orden,
       le asigna huecos ANTES de su entrega en tres pasadas: primero 1 h en días
       repartidos a lo largo del periodo, luego hasta 2 h por día y, si aún no alcanza,
       lo que quepa. Así una entrega lejana no se amontona en los primeros días.
    4. Une horas seguidas de la misma tarea en una sola sesión y las guarda.
    """
    d = request.get_json(silent=True) or {}
    hoy = fecha_o_hoy(d.get("hoy"))
    ahora = entero(d.get("minuto_actual"), 0, 1440, 0)
    desde = entero(d.get("desde"), 0, 23, 8)
    hasta = entero(d.get("hasta"), 1, 24, 22)
    max_horas = entero(d.get("max_horas"), 1, 12, 4)
    if hasta <= desde:
        return error("La hora final debe ser después de la inicial.")

    # 1. Replanear desde cero lo que no se ha hecho
    consultar("DELETE FROM sesiones WHERE hecha = 0")

    # 2. Pendientes en orden de urgencia y horas que les faltan
    tareas = consultar(f"""
        SELECT t.id, t.titulo, t.horas_estimadas, t.fecha_entrega,
               COALESCE(SUM(s.fin - s.inicio), 0) AS minutos_hechos
        FROM tareas t LEFT JOIN sesiones s ON s.tarea_id = t.id
        WHERE t.completada = 0
        GROUP BY t.id
        ORDER BY t.fecha_entrega IS NULL, t.fecha_entrega, {ORDEN_PRIORIDAD}, t.id""")

    # ¿Hasta qué día planear? Hasta la entrega más lejana: mínimo 7 días, máximo 4 semanas
    entregas = [como_fecha(t["fecha_entrega"]) for t in tareas if t["fecha_entrega"]]
    ultimo = max([hoy + timedelta(days=6)] + entregas)
    total_dias = min((ultimo - hoy).days + 1, HORIZONTE_DIAS)
    dias = [hoy + timedelta(days=i) for i in range(total_dias)]

    # 3. Huecos libres por día
    horario = consultar("SELECT dia, inicio, fin FROM horario")
    hechas = consultar("SELECT fecha, inicio, fin FROM sesiones WHERE fecha BETWEEN %s AND %s",
                       (dias[0].isoformat(), dias[-1].isoformat()))
    libres, estudio = {}, {}
    for dia in dias:
        ocupado = [(b["inicio"], b["fin"]) for b in horario if b["dia"] == dia.weekday()]
        ocupado += [(s["inicio"], s["fin"]) for s in hechas if como_fecha(s["fecha"]) == dia]
        primer_minuto = desde * 60
        if dia == hoy:  # hoy solo cuenta lo que falta del día
            primer_minuto = max(primer_minuto, -(-ahora // 60) * 60)
        libres[dia] = [m for m in range(primer_minuto, hasta * 60, 60)
                       if not any(m < f and m + 60 > i for i, f in ocupado)]
        estudio[dia] = sum(s["fin"] - s["inicio"] for s in hechas if como_fecha(s["fecha"]) == dia) // 60

    for t in tareas:
        t["faltan"] = max(0, -(-(t["horas_estimadas"] * 60 - int(t["minutos_hechos"])) // 60))
        entrega = como_fecha(t["fecha_entrega"]) if t["fecha_entrega"] else None
        if entrega is None:
            t["dias"] = dias[:7]                                  # sin fecha: dentro de esta semana
        elif entrega > hoy:
            t["dias"] = [dia for dia in dias if dia < entrega]   # terminar antes del día de entrega
        else:
            t["dias"] = [hoy]                                    # vence hoy o ya venció

    plan = []          # (tarea_id, fecha, minuto)
    for t in tareas:                       # la más urgente primero
        por_dia = {}
        for limite in (1, 2, 24):          # 1 h/día repartida → 2 h/día → lo que quepa
            for dia in dias_repartidos(t["dias"], t["faltan"]):
                while (t["faltan"] > 0 and libres[dia] and estudio[dia] < max_horas
                       and por_dia.get(dia, 0) < limite):
                    minuto = libres[dia].pop(0)
                    plan.append((t["id"], dia, minuto))
                    t["faltan"] -= 1
                    estudio[dia] += 1
                    por_dia[dia] = por_dia.get(dia, 0) + 1

    # 4. Unir horas seguidas de la misma tarea y guardar
    plan.sort(key=lambda p: (p[1], p[2]))
    sesiones = []
    for tarea_id, dia, minuto in plan:
        ultima = sesiones[-1] if sesiones else None
        if ultima and ultima["tarea_id"] == tarea_id and ultima["fecha"] == dia and ultima["fin"] == minuto:
            ultima["fin"] += 60
        else:
            sesiones.append({"tarea_id": tarea_id, "fecha": dia, "inicio": minuto, "fin": minuto + 60})
    for s in sesiones:
        consultar("INSERT INTO sesiones (tarea_id, fecha, inicio, fin) VALUES (%s, %s, %s, %s)",
                  (s["tarea_id"], s["fecha"].isoformat(), s["inicio"], s["fin"]))

    avisos = [f"A «{t['titulo']}» le faltan {t['faltan']} h: no cupieron antes de la entrega."
              for t in tareas if t["faltan"] > 0]
    ultima_fecha = max((s["fecha"] for s in sesiones), default=None)
    return jsonify(horas_planeadas=len(plan), sesiones_creadas=len(sesiones), avisos=avisos,
                   ultima_fecha=ultima_fecha.isoformat() if ultima_fecha else None)


def dias_repartidos(dias, horas):
    """
    Ordena los días para que las primeras horas caigan espaciadas a lo largo del periodo.
    Ej.: 3 horas en 9 días -> primero los días 0, 3 y 6; después el resto.
    """
    if horas <= 0 or horas >= len(dias):
        return dias
    paso = len(dias) / horas
    elegidos = [dias[int(i * paso)] for i in range(horas)]
    return elegidos + [d for d in dias if d not in elegidos]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

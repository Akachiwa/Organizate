# Organízate · Mini datacenter con Docker Compose

Planificador semanal para estudiantes: registras tu horario fijo y tus pendientes
(con fecha de entrega y horas estimadas) y la app reparte tus horas de estudio en
tus huecos libres, hasta 4 semanas adelante.

Parcial de Centro de Datos · Ingeniería en Datos e IA.

## Arquitectura (7 contenedores en la red `organizate_net`)

| Servicio | Imagen | Qué hace | Puerto |
| --- | --- | --- | --- |
| web | build `./web` (nginx:alpine) | Página + proxy de `/api` hacia app | 8080 |
| app | build `./app` (python:3.12-slim + Flask) | API y planificador; métricas en `/metrics` | interno |
| db | mysql:8.4 | Tablas horario, tareas y sesiones; datos en el volumen `db_data` | interno |
| adminer | adminer:latest | Ver la base de datos en el navegador | 8081 |
| blackbox | prom/blackbox-exporter | Comprueba que web, app, db y adminer respondan | interno |
| prometheus | prom/prometheus | Guarda las mediciones cada 15 s | 9090 |
| grafana | grafana/grafana | Tablero de monitoreo | 3000 |

## Cómo levantarlo

```bash
docker compose up -d --build
docker compose ps
```

- Página: http://localhost:8080
- Adminer: http://localhost:8081 (servidor `db`, usuario `organizate_user`, contraseña `organizate_pass`)
- Grafana: http://localhost:3000 (se ve sin iniciar sesión; admin / organizate para editar)
- Prometheus: http://localhost:9090/targets

## Estructura


> Las contraseñas de `compose.yaml` son de práctica. En producción irían en un archivo `.env` o en *secrets*.

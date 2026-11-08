-- Se ejecuta solo la primera vez, cuando el volumen de la base de datos está vacío
SET NAMES utf8mb4;
USE organizate;

-- Horario fijo: lo que se repite cada semana (clases, trabajo, gimnasio...)
-- dia: 0 = lunes ... 6 = domingo
-- inicio y fin: minutos desde las 00:00 (420 = 7:00, 540 = 9:00)
CREATE TABLE IF NOT EXISTS horario (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  titulo  VARCHAR(100) NOT NULL,
  tipo    ENUM('clase','trabajo','personal') NOT NULL DEFAULT 'clase',
  dia     TINYINT  NOT NULL,
  inicio  SMALLINT NOT NULL,
  fin     SMALLINT NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Pendientes: lo que hay que entregar y cuántas horas crees que te va a tomar
CREATE TABLE IF NOT EXISTS tareas (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  titulo          VARCHAR(150) NOT NULL,
  materia         VARCHAR(80)  NOT NULL DEFAULT 'General',
  fecha_entrega   DATE NULL,
  horas_estimadas TINYINT NOT NULL DEFAULT 2,
  prioridad       ENUM('alta','media','baja') NOT NULL DEFAULT 'media',
  completada      BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Sesiones de estudio: las crea el botón "Organizar mi semana"
CREATE TABLE IF NOT EXISTS sesiones (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  tarea_id  INT NOT NULL,
  fecha     DATE NOT NULL,
  inicio    SMALLINT NOT NULL,
  fin       SMALLINT NOT NULL,
  hecha     BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (tarea_id) REFERENCES tareas(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Datos de ejemplo
INSERT INTO horario (titulo, tipo, dia, inicio, fin) VALUES
('Bases de Datos',   'clase',    0, 420, 540),
('Centro de Datos',  'clase',    0, 600, 720),
('Estadística',      'clase',    1, 540, 660),
('Inglés',           'clase',    1, 720, 780),
('Bases de Datos',   'clase',    2, 420, 540),
('Centro de Datos',  'clase',    2, 600, 720),
('Estadística',      'clase',    3, 540, 660),
('Inglés',           'clase',    3, 720, 780),
('Programación',     'clase',    4, 420, 600),
('Gimnasio',         'personal', 0, 1080, 1140),
('Gimnasio',         'personal', 2, 1080, 1140),
('Gimnasio',         'personal', 4, 1080, 1140),
('Trabajo de medio tiempo', 'trabajo', 5, 540, 840);

INSERT INTO tareas (titulo, materia, fecha_entrega, horas_estimadas, prioridad) VALUES
('Parcial de Docker: mini datacenter', 'Centro de Datos', CURDATE() + INTERVAL 2 DAY, 4, 'alta'),
('Ensayo en inglés (500 palabras)',    'Inglés',          CURDATE() + INTERVAL 3 DAY, 2, 'media'),
('Guía de ejercicios de probabilidad', 'Estadística',     CURDATE() + INTERVAL 4 DAY, 3, 'media'),
('Proyecto final: dashboard en Python','Programación',    CURDATE() + INTERVAL 6 DAY, 5, 'alta'),
('Normalizar la base del proyecto',    'Bases de Datos',  CURDATE() + INTERVAL 6 DAY, 2, 'baja');

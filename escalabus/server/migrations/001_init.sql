-- EscalaBus: esquema inicial
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'real' CHECK (mode IN ('real', 'demo')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('motorista', 'cobrador')),
  shift_name TEXT NOT NULL,
  avail_start TEXT NOT NULL,
  avail_end TEXT NOT NULL,
  whatsapp TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX people_role_active ON people(role, active);

CREATE TABLE lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE buses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fleet_number TEXT NOT NULL UNIQUE,
  plate TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Serviços-modelo do fim de semana (cada um é uma vaga de motorista + cobrador)
CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL CHECK (weekday IN (0, 6)),
  line_id INTEGER NOT NULL REFERENCES lines(id),
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  shift_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Uma escala por fim de semana (identificada pelo sábado)
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saturday TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rascunho', 'confirmada', 'cancelada')),
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT
);
-- No máximo uma escala não cancelada por fim de semana
CREATE UNIQUE INDEX schedules_one_open_per_weekend ON schedules(saturday) WHERE status <> 'cancelada';

-- Registros da escala com cópia (snapshot) dos dados dos cadastros, preservando o histórico.
-- Os *_id não têm chave estrangeira de propósito: o histórico não pode depender do cadastro atual.
CREATE TABLE schedule_entries (
  uid TEXT PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  date TEXT NOT NULL,
  service_id INTEGER,
  line_id INTEGER,
  line_code TEXT NOT NULL DEFAULT '',
  line_description TEXT,
  bus_id INTEGER,
  bus_fleet TEXT NOT NULL DEFAULT '',
  bus_plate TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  shift_name TEXT NOT NULL DEFAULT '',
  driver_id INTEGER,
  driver_name TEXT NOT NULL DEFAULT '',
  conductor_id INTEGER,
  conductor_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX entries_schedule ON schedule_entries(schedule_id);
CREATE INDEX entries_date ON schedule_entries(date);
CREATE INDEX entries_driver ON schedule_entries(driver_id, date);
CREATE INDEX entries_conductor ON schedule_entries(conductor_id, date);

-- Registro de alterações (edição de escalas confirmadas, confirmações, cancelamentos)
CREATE TABLE schedule_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX audit_schedule ON schedule_audit(schedule_id);

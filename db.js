const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');

if (!fs.existsSync('./data')) fs.mkdirSync('./data');
const db = new Database('./data/casehub.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL DEFAULT 0,
  public_id TEXT UNIQUE NOT NULL,
  is_admin INTEGER DEFAULT 0,
  equipped_id INTEGER DEFAULT 0,
  daily_deposit REAL DEFAULT 0,
  last_deposit_date TEXT DEFAULT '',
  best_drop_name TEXT DEFAULT 'Нет',
  best_drop_icon TEXT DEFAULT '❌',
  best_drop_price REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  icon TEXT DEFAULT '📦',
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS case_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🎁',
  price REAL NOT NULL,
  chance REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🎁',
  price REAL NOT NULL,
  equipped INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  uses_left INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS promo_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  UNIQUE(promo_id, user_id)
);
`);

const casesCount = db.prepare('SELECT COUNT(*) AS c FROM cases').get().c;
if (casesCount === 0) {
  const insCase = db.prepare('INSERT INTO cases (name, price, icon) VALUES (?,?,?)');
  const insItem = db.prepare('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES (?,?,?,?,?)');

  // Настоящие картинки скинов CS:GO
  const imgRedline = 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvEoy9e3d1Z0JwR0s_6QlTZq0_39_02kQ7uNk4qJ2v0e8_1j_uX7g0a6Q';
  const imgAsiimov = 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsTzk4cT1S7G1gY2VWaR_2M_2kI_CwtEa2Vf8lNHVcC1sS3V0dK2kQ';
  const imgKnife = 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsTzk4cT1S7G1gY2VWaR_2M_2kI_CwtEa2Vf8lNHVcC1sS3V0dK2kQ';
  const imgHowl = 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsTzk4cT1S7G1gY2VWaR_2M_2kI_CwtEa2Vf8lNHVcC1sS3V0dK2kQ';

  // Массив с кейсами (как на Case-Battle)
  const caseData = [
    { name: 'Джейсон', price: 89 }, { name: 'Лусия', price: 199 }, { name: 'Брайан', price: 299 },
    { name: 'Рауль', price: 799 }, { name: 'GTA VI', price: 2499 }, { name: 'Чужой', price: 39 },
    { name: 'Гремлин', price: 119 }, { name: 'Крик', price: 349 }, { name: 'Пила', price: 699 },
    { name: 'Чаки', price: 1499 }, { name: 'Коэн', price: 49 }, { name: 'Лакра', price: 149 },
    { name: 'Ксанте', price: 499 }, { name: 'Бренсис', price: 899 }, { name: 'The Blood of Dawnwalker', price: 2999 },
    { name: 'Lonestar', price: 29 }, { name: 'Valkyra', price: 99 }, { name: 'Manticore', price: 249 },
    { name: 'Kolchia', price: 399 }, { name: 'Wardogs', price: 999 }, { name: 'Эйнштейн', price: 69 },
    { name: 'Менделеев', price: 199 }, { name: 'Дарвин', price: 499 }, { name: 'Гаусс', price: 1999 },
    { name: 'Коперник', price: 5999 }, { name: 'Брелоки', price: 75 }, { name: 'Наборы Музыки', price: 199 }, 
    { name: 'Нашивки', price: 189 }, { name: 'Нашивки команд', price: 439 }, { name: 'Пины', price: 499 }, 
    { name: 'Агенты', price: 999 }, { name: 'Капсулы', price: 109 }, { name: 'Наклейки S-box', price: 50 }, 
    { name: 'Наклейки M-box', price: 150 }, { name: 'Наклейки XL-box', price: 300 }, { name: 'Детектив Пикачу', price: 52 }, 
    { name: 'Case-Battle', price: 55 }, { name: 'Берсерк', price: 120 }, { name: 'Веном', price: 140 }, 
    { name: 'Гладиатор', price: 379 }, { name: 'Major 2021', price: 499 }, { name: 'Major 2022', price: 650 }, 
    { name: 'Major 2024', price: 750 }, { name: 'Евро 2020', price: 269 }, { name: 'Евро 2024', price: 1269 }, 
    { name: 'Изумрудный кейс', price: 499 }, { name: 'Рубиновый кейс', price: 1600999 }, { name: 'Сапфировый кейс', price: 1999 }, 
    { name: 'Алмазный', price: 2999 }, { name: 'iCase', price: 5000 }, { name: 'Гранд Слэм', price: 10000 }, 
    { name: 'Чёрный Алмаз', price: 20000 }, { name: 'Рокфеллер', price: 30000 }, { name: 'Чингиз Хан', price: 50000 }, 
    { name: 'Биткоин', price: 100000 }, { name: 'Камуфляжный', price: 29 }, { name: 'Зеленые скины', price: 59 }, 
    { name: 'Желтые скины', price: 89 }, { name: 'Белые скины', price: 99 }, { name: 'Синие скины', price: 105 }, 
    { name: 'Фиолетовые скины', price: 129 }, { name: 'Черные скины', price: 149 }, { name: 'Красные скины', price: 185 }, 
    { name: 'Инь и Янь', price: 494 }, { name: 'Рунический', price: 29 }, { name: 'Сильвер Элита', price: 13 }, 
    { name: 'Звезды', price: 25 }, { name: 'Калаши', price: 35 }, { name: 'Биг Стар', price: 45 }, { name: 'Глобал Элита', price: 79 },
  ];

  caseData.forEach((c) => {
    const caseId = insCase.run(c.name, c.price, '📦').lastInsertRowid;
    // Добавляем по 3 скина в каждый кейс
    insItem.run(caseId, 'AK-47 | Redline', imgRedline, 2500, 60);
    insItem.run(caseId, 'AWP | Asiimov', imgAsiimov, 10000, 30);
    insItem.run(caseId, '★ Knife', imgKnife, 150000, 10);
  });
}

const admin = db.prepare('SELECT * FROM users WHERE login = ?').get(process.env.ADMIN_LOGIN || 'xlepl');
if (!admin) {
  db.prepare('INSERT INTO users (login, password_hash, public_id, is_admin, balance) VALUES (?,?,?,1,1000000)')
    .run(process.env.ADMIN_LOGIN || 'xlepl', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'мама154951', 10), 'ADMIN-000001');
  console.log('✅ Админ создан: xlepl / мама154951');
}
module.exports = db;
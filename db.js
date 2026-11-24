require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance REAL DEFAULT 0,
      public_id TEXT UNIQUE NOT NULL,
      is_admin INTEGER DEFAULT 0,
      equipped_id INTEGER DEFAULT 0,
      best_drop_name TEXT DEFAULT 'Нет',
      best_drop_icon TEXT DEFAULT '❌',
      best_drop_price REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cases (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      icon TEXT DEFAULT '📦'
    );
    CREATE TABLE IF NOT EXISTS case_items (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🎁',
      price REAL NOT NULL,
      chance REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🎁',
      price REAL NOT NULL,
      equipped INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS promos (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      uses_left INTEGER DEFAULT 1
    );
  `);

  const res = await pool.query('SELECT COUNT(*) FROM cases');
  if (parseInt(res.rows[0].count) === 0) {
    const img = 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvEoy9e3d1Z0JwR0s_6QlTZq0_39_02kQ7uNk4qJ2v0e8_1j_uX7g0a6Q';
    
    const caseData = [
      { name: 'Джейсон', price: 89 }, { name: 'Лусия', price: 199 }, { name: 'Брайан', price: 299 },
      { name: 'Рауль', price: 799 }, { name: 'GTA VI', price: 2499 }, { name: 'Чужой', price: 39 }
    ];
    for (const c of caseData) {
      const cr = await pool.query('INSERT INTO cases (name, price, icon) VALUES ($1, $2, $3) RETURNING id', [c.name, c.price, '📦']);
      const cid = cr.rows[0].id;
      await pool.query('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES ($1, $2, $3, $4, $5)', [cid, 'AK-47 | Redline', img, 2500, 60]);
      await pool.query('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES ($1, $2, $3, $4, $5)', [cid, 'AWP | Asiimov', img, 10000, 30]);
      await pool.query('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES ($1, $2, $3, $4, $5)', [cid, 'Knife', img, 150000, 10]);
    }
  }

  const admin = await pool.query('SELECT * FROM users WHERE login = $1', [process.env.ADMIN_LOGIN || 'xlepl']);
  if (admin.rows.length === 0) {
    await pool.query('INSERT INTO users (login, password_hash, public_id, is_admin, balance) VALUES ($1, $2, $3, 1, 1000000)', 
      [process.env.ADMIN_LOGIN || 'xlepl', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'мама154951', 10), 'ADMIN-1']);
  }
}
initDb().catch(console.error);
module.exports = pool;
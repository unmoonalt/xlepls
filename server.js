require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const sign = (u) => jwt.sign({ id: u.id, is_admin: !!u.is_admin }, JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => { const t = req.cookies.token; if (!t) return res.status(401).json({ error: 'Нет токена' }); try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Неверный токен' }); } };
const adminOnly = (req, res, next) => { if (!req.user?.is_admin) return res.status(403).json({ error: 'Только админ' }); next(); };
const publicView = (u) => ({ id: u.id, login: u.login, balance: u.balance, public_id: u.public_id, is_admin: !!u.is_admin, equipped_id: u.equipped_id, best_drop_name: u.best_drop_name, best_drop_icon: u.best_drop_icon, best_drop_price: u.best_drop_price });

const getMultiplier = (price) => {
  if (price >= 100000000) return 2.0; if (price >= 10000000) return 1.80; if (price >= 1000000) return 1.65;
  if (price >= 100000) return 1.50; if (price >= 10000) return 1.25; if (price >= 2500) return 1.05; return 1.0;
};

app.post('/api/login', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE login=$1', [req.body.login]);
  if (user.rows.length === 0 || !bcrypt.compareSync(req.body.password || '', user.rows[0].password_hash)) return res.status(401).json({ error: 'Неверные данные' });
  res.cookie('token', sign(user.rows[0]), { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: publicView(user.rows[0]) });
});
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, async (req, res) => { const u = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]); res.json(publicView(u.rows[0])); });

app.get('/api/cases', async (req, res) => {
  const cases = await db.query('SELECT * FROM cases');
  const result = await Promise.all(cases.rows.map(async c => ({ ...c, items: (await db.query('SELECT * FROM case_items WHERE case_id=$1', [c.id])).rows })));
  res.json(result);
});

app.post('/api/cases/:id/open', auth, async (req, res) => {
  const c = (await db.query('SELECT * FROM cases WHERE id=$1', [req.params.id])).rows[0];
  const user = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (user.balance < c.price) return res.status(400).json({ error: 'Мало средств' });
  
  const items = (await db.query('SELECT * FROM case_items WHERE case_id=$1', [c.id])).rows;
  const total = items.reduce((s, i) => s + i.chance, 0);
  let r = Math.random() * total; let win = items[items.length - 1];
  for (const it of items) { r -= it.chance; if (r <= 0) { win = it; break; } }

  await db.query('UPDATE users SET balance = balance - $1 WHERE id=$2', [c.price, user.id]);
  await db.query('INSERT INTO inventory (user_id, name, icon, price) VALUES ($1, $2, $3, $4)', [user.id, win.name, win.icon, win.price]);
  if (win.price > (user.best_drop_price || 0)) await db.query('UPDATE users SET best_drop_name=$1, best_drop_icon=$2, best_drop_price=$3 WHERE id=$4', [win.name, win.icon, win.price, user.id]);
  
  res.json({ ok: true, win, allItems: items, newBalance: user.balance - c.price });
});

app.get('/api/inventory', auth, async (req, res) => {
  const inv = (await db.query('SELECT * FROM inventory WHERE user_id=$1 ORDER BY id DESC', [req.user.id])).rows;
  res.json(inv.map(i => ({ ...i, multiplier: getMultiplier(i.price) })));
});

app.post('/api/inventory/:id/equip', auth, async (req, res) => {
  const item = (await db.query('SELECT * FROM inventory WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
  const user = (await db.query('SELECT equipped_id FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (user.equipped_id === item.id) {
    await db.query('UPDATE inventory SET equipped=0 WHERE id=$1', [item.id]);
    await db.query('UPDATE users SET equipped_id=0 WHERE id=$1', [req.user.id]);
  } else {
    await db.query('UPDATE inventory SET equipped=0 WHERE user_id=$1', [req.user.id]);
    await db.query('UPDATE inventory SET equipped=1 WHERE id=$1', [item.id]);
    await db.query('UPDATE users SET equipped_id=$1 WHERE id=$2', [item.id, req.user.id]);
  }
  res.json({ ok: true });
});

app.post('/api/inventory/:id/sell', auth, async (req, res) => {
  const item = (await db.query('SELECT * FROM inventory WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
  const sellPrice = item.price * (item.equipped ? getMultiplier(item.price) : 1.0);
  await db.query('DELETE FROM inventory WHERE id=$1', [item.id]);
  await db.query('UPDATE users SET balance = balance + $1, equipped_id = CASE WHEN equipped_id=$2 THEN 0 ELSE equipped_id END WHERE id=$3', [sellPrice, item.id, req.user.id]);
  res.json({ ok: true, newBalance: (await db.query('SELECT balance FROM users WHERE id=$1', [req.user.id])).rows[0].balance, earned: sellPrice });
});

app.post('/api/deposit', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  const user = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!user.is_admin && amount > 50000) return res.status(400).json({ error: `Лимит 50 000 ₽/день.` });
  await db.query('UPDATE users SET balance = balance + $1 WHERE id=$2', [amount, req.user.id]);
  res.json({ ok: true, newBalance: (await db.query('SELECT balance FROM users WHERE id=$1', [req.user.id])).rows[0].balance });
});

app.post('/api/upgrade', auth, async (req, res) => {
  const item = (await db.query('SELECT * FROM inventory WHERE id=$1 AND user_id=$2', [req.body.inventory_id, req.user.id])).rows[0];
  const target = (await db.query('SELECT * FROM case_items WHERE id=$1', [req.body.target_case_item_id])).rows[0];
  if (!item || !target || target.price <= item.price) return res.status(400).json({ error: 'Ошибка' });
  
  const chance = Math.min(0.9, item.price / target.price);
  const success = Math.random() < chance;
  await db.query('DELETE FROM inventory WHERE id=$1', [item.id]);
  await db.query('UPDATE users SET equipped_id = CASE WHEN equipped_id=$1 THEN 0 ELSE equipped_id END WHERE id=$2', [item.id, req.user.id]);
  if (success) await db.query('INSERT INTO inventory (user_id, name, icon, price) VALUES ($1, $2, $3, $4)', [req.user.id, target.name, target.icon, target.price]);
  res.json({ ok: true, success, chance, target });
});

app.get('/api/leaderboard', async (req, res) => {
  res.json({
    topMoney: (await db.query('SELECT login, balance FROM users ORDER BY balance DESC LIMIT 10')).rows,
    topDrops: (await db.query('SELECT login, best_drop_name, best_drop_icon, best_drop_price FROM users WHERE best_drop_price > 0 ORDER BY best_drop_price DESC LIMIT 10')).rows
  });
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => res.json((await db.query('SELECT id, login, balance, public_id FROM users')).rows));
app.post('/api/admin/give-money', auth, adminOnly, async (req, res) => { await db.query('UPDATE users SET balance = balance + $1 WHERE id=$2', [req.body.amount, req.body.user_id]); res.json({ ok: true }); });
app.post('/api/admin/reset-balance', auth, adminOnly, async (req, res) => { await db.query('UPDATE users SET balance=0, best_drop_price=0 WHERE id=$1', [req.body.user_id]); res.json({ ok: true }); });
app.delete('/api/admin/case/:id', auth, adminOnly, async (req, res) => { await db.query('DELETE FROM cases WHERE id=$1', [req.params.id]); await db.query('DELETE FROM case_items WHERE case_id=$1', [req.params.id]); res.json({ ok: true }); });
app.post('/api/admin/generate-case', auth, adminOnly, async (req, res) => {
  const { name, price } = req.body;
  const response = await fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/ru/skins.json');
  const skins = await response.json();
  const randomSkins = skins.sort(() => 0.5 - Math.random()).slice(0, 15);
  const caseId = (await db.query('INSERT INTO cases (name, price, icon) VALUES ($1, $2, $3) RETURNING id', [name, price, '📦'])).rows[0].id;
  for (let i = 0; i < randomSkins.length; i++) {
    await db.query('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES ($1, $2, $3, $4, $5)', [caseId, randomSkins[i].name, randomSkins[i].image, Math.floor(Math.random() * 50000) + 100, i < 9 ? 60 : i < 13 ? 30 : 10]);
  }
  res.json({ ok: true });
});
app.post('/api/admin/promo', auth, adminOnly, async (req, res) => { try { await db.query('INSERT INTO promos (code, amount, uses_left) VALUES ($1, $2, $3)', [req.body.code, req.body.amount, req.body.uses_left]); res.json({ ok: true }); } catch { res.status(400).json({ error: 'Ошибка' }); } });

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Server started`));
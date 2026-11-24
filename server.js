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

const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }) });

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const sign = (u) => jwt.sign({ id: u.id, is_admin: !!u.is_admin }, JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => { const t = req.cookies.token; if (!t) return res.status(401).json({ error: 'Нет токена' }); try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Неверный токен' }); } };
const adminOnly = (req, res, next) => { if (!req.user?.is_admin) return res.status(403).json({ error: 'Только админ' }); next(); };
const publicView = (u) => ({ id: u.id, login: u.login, balance: u.balance, public_id: u.public_id, is_admin: !!u.is_admin, equipped_id: u.equipped_id, best_drop_name: u.best_drop_name, best_drop_icon: u.best_drop_icon, best_drop_price: u.best_drop_price });

const getMultiplier = (price) => {
  if (price >= 100000000) return 2.0; if (price >= 10000000) return 1.80; if (price >= 1000000) return 1.65;
  if (price >= 100000) return 1.50; if (price >= 10000) return 1.25; if (price >= 2500) return 1.05; return 1.0;
};

app.post('/api/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE login=?').get(req.body.login);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Неверные данные' });
  res.cookie('token', sign(user), { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: publicView(user) });
});
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(publicView(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));

app.get('/api/cases', (req, res) => {
  const cases = db.prepare('SELECT * FROM cases WHERE active=1').all();
  const itemStmt = db.prepare('SELECT * FROM case_items WHERE case_id=?');
  res.json(cases.map(c => ({ ...c, items: itemStmt.all(c.id) })));
});

app.post('/api/cases/:id/open', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (user.balance < c.price) return res.status(400).json({ error: 'Мало средств' });
  
  const items = db.prepare('SELECT * FROM case_items WHERE case_id=?').all(c.id);
  const total = items.reduce((s, i) => s + i.chance, 0);
  let r = Math.random() * total; let win = items[items.length - 1];
  for (const it of items) { r -= it.chance; if (r <= 0) { win = it; break; } }

  db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(c.price, user.id);
  db.prepare('INSERT INTO inventory (user_id, name, icon, price) VALUES (?,?,?,?)').run(user.id, win.name, win.icon, win.price);
  
  if (win.price > (user.best_drop_price || 0)) {
    db.prepare('UPDATE users SET best_drop_name=?, best_drop_icon=?, best_drop_price=? WHERE id=?').run(win.name, win.icon, win.price, user.id);
  }
  res.json({ ok: true, win, allItems: items, newBalance: user.balance - c.price });
});

app.get('/api/inventory', auth, (req, res) => {
  const inv = db.prepare('SELECT * FROM inventory WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json(inv.map(i => ({ ...i, multiplier: getMultiplier(i.price) })));
});

app.post('/api/inventory/:id/equip', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Нет предмета' });
  
  const user = db.prepare('SELECT equipped_id FROM users WHERE id=?').get(req.user.id);
  if (user.equipped_id === item.id) {
    db.prepare('UPDATE inventory SET equipped=0 WHERE id=?').run(item.id);
    db.prepare('UPDATE users SET equipped_id=0 WHERE id=?').run(req.user.id);
  } else {
    db.prepare('UPDATE inventory SET equipped=0 WHERE user_id=?').run(req.user.id);
    db.prepare('UPDATE inventory SET equipped=1 WHERE id=?').run(item.id);
    db.prepare('UPDATE users SET equipped_id=? WHERE id=?').run(item.id, req.user.id);
  }
  res.json({ ok: true });
});

app.post('/api/inventory/:id/sell', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  const multiplier = item.equipped ? getMultiplier(item.price) : 1.0;
  const sellPrice = item.price * multiplier;
  
  db.prepare('DELETE FROM inventory WHERE id=?').run(item.id);
  db.prepare('UPDATE users SET balance = balance + ?, equipped_id = CASE WHEN equipped_id=? THEN 0 ELSE equipped_id END WHERE id=?').run(sellPrice, item.id, req.user.id);
  res.json({ ok: true, newBalance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance, earned: sellPrice });
});

app.post('/api/deposit', auth, (req, res) => {
  const amount = Number(req.body.amount);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const today = new Date().toISOString().split('T')[0];
  let currentDaily = user.daily_deposit || 0;
  
  if (user.last_deposit_date !== today) {
    currentDaily = 0; db.prepare('UPDATE users SET daily_deposit=0, last_deposit_date=? WHERE id=?').run(today, req.user.id);
  }
  if (!user.is_admin && currentDaily + amount > 50000) return res.status(400).json({ error: `Лимит 50 000 ₽/день. Осталось: ${50000 - currentDaily} ₽` });

  db.prepare('UPDATE users SET balance = balance + ?, daily_deposit = ? WHERE id=?').run(amount, currentDaily + amount, req.user.id);
  res.json({ ok: true, newBalance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
});

app.post('/api/upgrade', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id=? AND user_id=?').get(req.body.inventory_id, req.user.id);
  const target = db.prepare('SELECT * FROM case_items WHERE id=?').get(req.body.target_case_item_id);
  if (!item || !target || target.price <= item.price) return res.status(400).json({ error: 'Ошибка выбора' });
  
  const chance = Math.min(0.9, item.price / target.price);
  const success = Math.random() < chance;
  
  db.prepare('DELETE FROM inventory WHERE id=?').run(item.id);
  db.prepare('UPDATE users SET equipped_id = CASE WHEN equipped_id=? THEN 0 ELSE equipped_id END WHERE id=?').run(item.id, req.user.id);
  if (success) db.prepare('INSERT INTO inventory (user_id, name, icon, price) VALUES (?,?,?,?)').run(req.user.id, target.name, target.icon, target.price);
  
  res.json({ ok: true, success, chance, target });
});

app.get('/api/leaderboard', (req, res) => {
  res.json({
    topMoney: db.prepare('SELECT login, balance FROM users ORDER BY balance DESC LIMIT 10').all(),
    topDrops: db.prepare('SELECT login, best_drop_name, best_drop_icon, best_drop_price FROM users WHERE best_drop_price > 0 ORDER BY best_drop_price DESC LIMIT 10').all()
  });
});

// === АДМИНКА ===
app.get('/api/admin/users', auth, adminOnly, (req, res) => res.json(db.prepare('SELECT id, login, balance, public_id FROM users').all()));
app.post('/api/admin/give-money', auth, adminOnly, (req, res) => { db.prepare('UPDATE users SET balance = balance + ? WHERE id=?').run(req.body.amount, req.body.user_id); res.json({ ok: true }); });
app.post('/api/admin/reset-balance', auth, adminOnly, (req, res) => { db.prepare('UPDATE users SET balance=0, best_drop_price=0 WHERE id=?').run(req.body.user_id); res.json({ ok: true }); });
app.delete('/api/admin/case/:id', auth, adminOnly, (req, res) => { db.prepare('DELETE FROM cases WHERE id=?').run(req.params.id); db.prepare('DELETE FROM case_items WHERE case_id=?').run(req.params.id); res.json({ ok: true }); });

// АВТОГЕНЕРАЦИЯ КЕЙСОВ ИЗ CS:GO API
app.post('/api/admin/generate-case', auth, adminOnly, async (req, res) => {
  try {
    const { name, price } = req.body;
    const response = await fetch('https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/ru/skins.json');
    const skins = await response.json();
    
    const randomSkins = skins.sort(() => 0.5 - Math.random()).slice(0, 15);
    const caseId = db.prepare('INSERT INTO cases (name, price, icon) VALUES (?,?,?)').run(name, price, '📦').lastInsertRowid;
    
    const insItem = db.prepare('INSERT INTO case_items (case_id, name, icon, price, chance) VALUES (?,?,?,?,?)');
    randomSkins.forEach((skin, index) => {
      // Генерируем рандомную цену от 100 до 50000 в зависимости от редкости
      const itemPrice = Math.floor(Math.random() * 50000) + 100;
      // Шансы: 60% для дешевых, 30% средних, 10% дорогих
      const chance = index < 9 ? 60 : index < 13 ? 30 : 10;
      insItem.run(caseId, skin.name, skin.image, itemPrice, chance);
    });
    res.json({ ok: true, message: `Кейс ${name} создан с ${randomSkins.length} скинами!` });
  } catch (err) { res.status(500).json({ error: 'Ошибка API: ' + err.message }); }
});

app.post('/api/admin/upload', auth, adminOnly, upload.single('image'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Нет файла' }); res.json({ ok: true, url: '/uploads/' + req.file.filename }); });
app.post('/api/admin/promo', auth, adminOnly, (req, res) => { try { db.prepare('INSERT INTO promos (code, amount, uses_left) VALUES (?,?,?)').run(req.body.code, req.body.amount, req.body.uses_left); res.json({ ok: true }); } catch { res.status(400).json({ error: 'Ошибка' }); } });

app.listen(process.env.PORT || 3000, () => console.log(`🚀 http://localhost:3000`));
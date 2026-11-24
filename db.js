  try {
    const admin = await pool.query('SELECT * FROM users WHERE login = $1', [process.env.ADMIN_LOGIN || 'xlepl']);
    if (admin.rows.length === 0) {
      await pool.query('INSERT INTO users (login, password_hash, public_id, is_admin, balance) VALUES ($1, $2, $3, 1, 1000000)', 
        [process.env.ADMIN_LOGIN || 'xlepl', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'мама154951', 10), 'ADMIN-1']);
      console.log('✅ Админ успешно создан в базе!');
    } else {
      console.log('✅ Админ уже есть в базе.');
    }
  } catch (err) {
    console.error('❌ Ошибка при создании админа:', err);
  }
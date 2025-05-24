const bcrypt = require('bcryptjs');
const db = require('./db'); // Путь к db.js

const adminData = {
  email: '',
  password: ''
};

(async () => {
  try {
    // Генерация хэша
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(adminData.password, salt);

    // Вставка в БД
    await db.query(
      'INSERT INTO admins (email, password_hash) VALUES ($1, $2)',
      [adminData.email, hash]
    );

    console.log('✅ Администратор успешно создан');
  } catch (err) {
    console.error('❌ Ошибка:', err);
  } finally {
    process.exit();
  }
})();
// db.js
const { Pool } = require('pg');

/*const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'event_platform',
  password: 'vfr2012cbv',
  port: 5432
});
*/

// Получение строки подключения из переменных окружения Render.com
const connectionString = process.env.DATABASE_URL;

// Проверка подключения
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL подключен'))
  .catch(err => console.error('❌ Ошибка подключения:', err));

module.exports = { query: (text, params) => pool.query(text, params) };
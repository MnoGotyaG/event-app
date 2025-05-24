const db = require('../db'); // Убедись, что у тебя есть файл db.js для подключения к PostgreSQL

async function getAllLocations() {
  const result = await db.query('SELECT * FROM locations ORDER BY metro_station');
  return result.rows;
}

module.exports = { getAllLocations };

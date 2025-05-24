const express = require('express');
const router = express.Router();
const db = require('../db');

// Маршрут для получения списка мероприятий
router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const twoWeeksLater = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const { location: queryLocation, theme: queryTheme, city: queryCity } = req.query;
    const selectedCityId = req.session.city_id;

    // Получаем данные из БД
    const cities = await db.query('SELECT * FROM cities');
    const locations = await db.query(
      'SELECT * FROM locations WHERE city_id = COALESCE($1, city_id)',
      [selectedCityId]
    );
    const themes = await db.query('SELECT * FROM themes');

    // Формируем SQL-запрос
    let query = `
      SELECT 
        e.id, 
        e.title, 
        e.description,
        e.event_date,
        l.metro_station,
        l.address,
        t.name as theme,
        l.city_id
      FROM events e
      JOIN locations l ON e.location_id = l.id
      JOIN themes t ON e.theme_id = t.id
      WHERE e.event_date BETWEEN $1 AND $2
      ${selectedCityId ? 'AND l.city_id = $3' : ''}
    `;

    const params = [today, twoWeeksLater];
    if (selectedCityId) params.push(selectedCityId);

    // Добавляем фильтры
    if (queryLocation) {
      query += ' AND l.id = $' + (params.length + 1);
      params.push(queryLocation);
    }
    if (queryTheme) {
      query += ' AND t.id = $' + (params.length + 1);
      params.push(queryTheme);
    }

    query += ' ORDER BY e.event_date ASC';

    // Выполняем запрос
    const result = await db.query(query, params);

    // Рендерим шаблон
    res.render('events', {
      title: 'Мероприятия',
      stylesheet: '/css/events.css',
      events: result.rows,
      //cities: cities.rows,
      locations: locations.rows,
      themes: themes.rows,
      user: req.session.user,
      queryLocation: queryLocation || '',
      queryTheme: queryTheme || '',
      //queryCity: queryCity || ''
    });

  } catch (err) {
    console.error('Ошибка загрузки мероприятий:', err);
    res.status(500).render('error', { message: 'Ошибка сервера' });
  }
});

// Маршрут для получения данных мероприятия
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        e.*,
        l.metro_station,
        l.address,
        t.name as theme
      FROM events e
      JOIN locations l ON e.location_id = l.id
      JOIN themes t ON e.theme_id = t.id
      WHERE e.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Мероприятие не найдено' });
    }

    const event = {
      ...result.rows[0],
      event_date: new Date(result.rows[0].event_date).toISOString()
    };

    res.json(event);
  } catch (err) {
    console.error('Ошибка загрузки мероприятия:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Маршрут для регистрации
router.post('/:id/register', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ 
      error: 'Требуется авторизация',
      redirect: '/users/login'
    });
  }

  try {
    // Проверка дублирования
    const existingReg = await db.query(
      'SELECT * FROM user_events WHERE user_id = $1 AND event_id = $2',
      [req.session.user.id, req.params.id]
    );

    if (existingReg.rows.length > 0) {
      return res.status(400).json({ error: 'Вы уже зарегистрированы' });
    }

    // Регистрация
    await db.query(
      'INSERT INTO user_events (user_id, event_id) VALUES ($1, $2)',
      [req.session.user.id, req.params.id]
    );

    res.json({ message: 'Регистрация прошла успешно!' });

  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
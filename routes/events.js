const express = require('express');
const router = express.Router();
const db = require('../db');

// Маршрут для получения списка мероприятий
router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const twoWeeksLater = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
    const { location: queryLocation, theme: queryTheme } = req.query;

    // Валидация числовых параметров
    const parseIntegerParam = (value, paramName) => {
      if (!value) return null;
      const num = parseInt(value, 10);
      return isNaN(num) ? null : num;
    };

    const locationId = parseIntegerParam(queryLocation, 'location');
    const themeId = parseIntegerParam(queryTheme, 'theme');

    // Получаем выбранный город из сессии (проверяем на число)
    const selectedCityId = typeof req.session.city_id === 'number' 
      ? req.session.city_id 
      : null;

    // Запросы к БД
    const [cities, locations, themes] = await Promise.all([
      db.query('SELECT * FROM cities'),
      db.query(
        'SELECT * FROM locations WHERE city_id = COALESCE($1, city_id)',
        [selectedCityId]
      ),
      db.query('SELECT * FROM themes')
    ]);

    // Базовый SQL-запрос
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
    `;

    const params = [today, twoWeeksLater];
    let paramIndex = 3;

    // Фильтр по городу
    if (selectedCityId) {
      query += ` AND l.city_id = $${paramIndex}`;
      params.push(selectedCityId);
      paramIndex++;
    }

    // Фильтр по локации (только если валидный ID)
    if (locationId !== null) {
      query += ` AND l.id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    // Фильтр по тематике (только если валидный ID)
    if (themeId !== null) {
      query += ` AND t.id = $${paramIndex}`;
      params.push(themeId);
      paramIndex++;
    }

    query += ' ORDER BY e.event_date ASC';

    // Выполнение запроса
    const result = await db.query(query, params);

    // Рендеринг с данными
    res.render('events', {
      title: 'Мероприятия',
      stylesheet: '/css/events.css',
      events: result.rows,
      locations: locations.rows,
      themes: themes.rows,
      user: req.session.user,
      queryLocation: locationId || '',
      queryTheme: themeId || ''
    });

  } catch (err) {
    console.error('Ошибка загрузки мероприятий:', err);
    res.status(500).render('error', { 
      title: 'Ошибка',
      message: 'Не удалось загрузить мероприятия' 
    });
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
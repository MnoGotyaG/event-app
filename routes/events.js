const express = require('express');
const router = express.Router();
const db = require('../db');

// Маршрут для получения списка мероприятий
router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const twoWeeksLater = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
    const { location: queryLocation, theme: queryTheme } = req.query;

    // Валидация параметров
    const parseParam = (value) => value ? parseInt(value, 10) || null : null;
    const locationId = parseParam(queryLocation);
    const themeId = parseParam(queryTheme);
    const selectedCityId = req.session.city_id ? parseInt(req.session.city_id, 10) : null;

    // Формируем условия и параметры
    const conditions = [];
    const params = [today, twoWeeksLater];

    // Условие для города
    if (selectedCityId) {
      conditions.push(`l.city_id = $${params.length + 1}`);
      params.push(selectedCityId);
    }

    // Условие для локации
    if (locationId !== null) {
      conditions.push(`l.id = $${params.length + 1}`);
      params.push(locationId);
    }

    // Условие для темы
    if (themeId !== null) {
      conditions.push(`t.id = $${params.length + 1}`);
      params.push(themeId);
    }

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
      ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
      ORDER BY e.event_date ASC
    `;

    // Логирование для отладки
    console.log('SQL Query:', query);
    console.log('Params:', params);

    // Выполнение запроса
    const [eventsResult, citiesResult, locationsResult, themesResult] = await Promise.all([
      db.query(query, params),
      db.query('SELECT * FROM cities'),
      db.query('SELECT * FROM locations WHERE city_id = COALESCE($1, city_id)', [selectedCityId]),
      db.query('SELECT * FROM themes')
    ]);

    // Рендеринг шаблона
    res.render('events', {
      title: 'Мероприятия',
      events: eventsResult.rows,
      cities: citiesResult.rows,
      locations: locationsResult.rows,
      themes: themesResult.rows,
      user: req.session.user,
      queryLocation: locationId || '',
      queryTheme: themeId || '',
      sessionCity: selectedCityId
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


router.post('/set-city', async (req, res) => {
  try {
    const cityId = parseInt(req.body.city, 10);
    
    // Проверка существования города в БД
    const result = await db.query('SELECT id FROM cities WHERE id = $1', [cityId]);
    
    if (result.rows.length === 0) {
      return res.status(400).send('Неверный город');
    }

    // Сохраняем в сессии как число
    req.session.city_id = cityId;
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка сервера');
  }
});

module.exports = router;


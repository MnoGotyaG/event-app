const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

// Middleware проверки администратора
const isAdmin = (req, res, next) => {
  if (req.session.admin) {
    next();
  } else {
    req.session.error = 'Требуется авторизация администратора';
    res.redirect('/admin/login');
  }
};

// Форма входа администратора
router.get('/login', (req, res) => {
  res.render('admin-login', {
    title: 'Вход администратора',
    error: req.session.error
  });
  req.session.error = null;
});

// Добавьте в POST-обработчики
router.post('/cities', isAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        await db.query('INSERT INTO cities (name) VALUES ($1)', [name]);
        res.redirect('/admin/dashboard#cities');
    } catch (err) {
        res.status(500).send('Ошибка добавления города');
    }
});

// Обработка входа администратора
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM admins WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      req.session.error = 'Неверные учетные данные';
      return res.redirect('/admin/login');
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      req.session.error = 'Неверные учетные данные';
      return res.redirect('/admin/login');
    }

    req.session.admin = {
      id: admin.id,
      email: admin.email
    };

    res.redirect('/admin/dashboard');

  } catch (err) {
    console.error('Ошибка входа администратора:', err);
    res.status(500).render('error', { message: 'Ошибка сервера' });
  }
});

// Выход администратора
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/users', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id,
        first_name,
        last_name,
        email,
        TO_CHAR(birth_date, 'DD.MM.YYYY') AS birth_date, // Форматируем дату
        confirmed
      FROM users
    `);
    res.render('admin', { users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Главная админ-панель
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const [users, events, locations, themes, cities] = await Promise.all([
      db.query('SELECT * FROM users ORDER BY created_at DESC'),
      db.query(`
        SELECT 
          e.*,
          l.metro_station,
          l.address,
          COUNT(ue.user_id)::int as participants,
          SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END)::int as attended_count
        FROM events e
        LEFT JOIN user_events ue ON e.id = ue.event_id
        JOIN locations l ON e.location_id = l.id
        GROUP BY e.id, l.metro_station, l.address
        ORDER BY e.event_date DESC
      `),
      db.query(`
        SELECT l.*, c.name as city_name 
        FROM locations l
        JOIN cities c ON l.city_id = c.id
        ORDER BY l.metro_station
      `),
      db.query('SELECT * FROM themes ORDER BY name'),
      db.query('SELECT * FROM cities ORDER BY name'),
      db.query(`
        SELECT 
          e.title,
          e.event_date,
          COUNT(ue.user_id)::int as participants,
          SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END)::int as attended_count
        FROM events e
        LEFT JOIN user_events ue ON e.id = ue.event_id
        WHERE e.event_date < NOW()
        GROUP BY e.id
        ORDER BY e.event_date DESC
      `)
    ]);

    const pastEvents = await db.query(`
      SELECT 
        e.id,
        e.title,
        e.event_date,
        c.name as city_name,
        COUNT(ue.user_id)::int as participants,
        COALESCE(SUM(ue.attended::int), 0) as attended_count
      FROM events e
      LEFT JOIN user_events ue ON e.id = ue.event_id
      JOIN cities c ON e.city_id = c.id
      WHERE e.event_date < NOW() AT TIME ZONE 'UTC' + INTERVAL '3 HOUR' -- Для московского времени
      GROUP BY e.id, c.id
      ORDER BY e.event_date DESC
    `);
    
    // Активность пользователей (usersActivity)
    const usersActivity = await db.query(`
        SELECT 
            u.id,
            CONCAT(u.first_name, ' ', u.last_name) AS name,
            COUNT(ue.event_id) AS total_events,
            SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END) AS attended_events
        FROM user_events ue
        JOIN users u ON ue.user_id = u.id
        JOIN events e ON ue.event_id = e.id
        WHERE e.event_date < NOW()
        GROUP BY u.id
        ORDER BY attended_events DESC
        LIMIT 10
    `);

    // Для топа мероприятий
    const topEvents = await db.query(`
        SELECT 
            e.title,
            COUNT(ue.user_id) AS participants,
            SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END) AS attended
        FROM events e
        LEFT JOIN user_events ue ON e.id = ue.event_id
        WHERE e.event_date < NOW()
        GROUP BY e.id
        HAVING SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END) > 0
        ORDER BY attended DESC
        LIMIT 5
    `);

    res.render('admin', {
      title: 'Панель управления',
      users: users.rows,
      events: events.rows,
      locations: locations.rows,
      pastEvents: pastEvents.rows,
      admin: req.session.admin,
      usersActivity: usersActivity.rows,
      topEvents: topEvents.rows,
      themes: themes.rows,
      cities: cities.rows
    });

  } catch (err) {
    console.error('Ошибка загрузки данных:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки данных' });
  }
});


// Подтверждение пользователя
router.post('/confirm-user/:userId', isAdmin, async (req, res) => {
  try {
    await db.query('UPDATE users SET confirmed = TRUE WHERE id = $1', [req.params.userId]);
    res.redirect('/admin/dashboard#users');
  } catch (err) {
    console.error('Ошибка подтверждения:', err);
    res.status(500).render('error', { message: 'Ошибка подтверждения пользователя' });
  }
});

// Создание мероприятия
router.post('/events', isAdmin, async (req, res) => {
    try {
        const { 
            title, 
            description, 
            event_date, 
            city_id, 
            location_id, 
            theme_id, 
            max_participants 
        } = req.body;

        await db.query(
            `INSERT INTO events 
            (title, description, event_date, city_id, location_id, theme_id, max_participants)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                title, 
                description, 
                event_date, 
                city_id, 
                location_id, 
                theme_id, 
                max_participants || null
            ]
        );
        
        res.redirect('/admin/dashboard#events');
    } catch (err) {
        console.error('Ошибка создания мероприятия:', err);
        res.status(500).send('Ошибка создания мероприятия: ' + err.message);
    }
});
// Удаление мероприятия
router.post('/events/delete/:eventId', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM events WHERE id = $1', [req.params.eventId]);
    res.redirect('/admin/dashboard#events');
  } catch (err) {
    console.error('Ошибка удаления:', err);
    res.status(500).render('error', { message: 'Нельзя удалить мероприятие с участниками' });
  }
});

// Добавление локации
router.get('/locations', isAdmin, async (req, res) => {
    try {
        const { city_id } = req.query;
        const query = city_id 
            ? 'SELECT * FROM locations WHERE city_id = $1 ORDER BY metro_station'
            : 'SELECT * FROM locations ORDER BY metro_station';
        
        const values = city_id ? [city_id] : [];
        const result = await db.query(query, values);
        
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Удаление локации
router.post('/locations/delete/:locationId', isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM locations WHERE id = $1', [req.params.locationId]);
    res.redirect('/admin/dashboard#locations');
  } catch (err) {
    console.error('Ошибка удаления локации:', err);
    res.status(500).render('error', { message: 'Нельзя удалить используемую локацию' });
  }
});

// Фильтрация локаций
// Для локаций
router.get('/locations/filter', isAdmin, async (req, res) => {
    try {
        const { city_id } = req.query;
        let query = `
            SELECT l.*, c.name as city_name 
            FROM locations l
            JOIN cities c ON l.city_id = c.id
        `;
        
        const params = [];
        if(city_id) {
            query += ' WHERE l.city_id = $1';
            params.push(city_id);
        }
        
        query += ' ORDER BY l.metro_station';
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Фильтрация мероприятий
router.get('/events/filter', isAdmin, async (req, res) => {
    try {
        const { city_id } = req.query;
        let query = `
            SELECT e.*, c.name as city_name, 
            COUNT(ue.user_id)::int as participants,
            l.metro_station,
            l.address
            FROM events e
            LEFT JOIN user_events ue ON e.id = ue.event_id
            JOIN cities c ON e.city_id = c.id
            JOIN locations l ON e.location_id = l.id
        `;
        
        const params = [];
        if(city_id) {
            query += ' WHERE e.city_id = $1';
            params.push(city_id);
        }
        
        query += ' GROUP BY e.id, c.name, l.metro_station, l.address ORDER BY e.event_date DESC';
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Обновление мероприятия
router.post('/events/update', isAdmin, async (req, res) => {
    try {
        const { 
            eventId,
            title,
            description,
            event_date,
            location_id,
            max_participants 
        } = req.body;

        await db.query(
            `UPDATE events SET
                title = $1,
                description = $2,
                event_date = $3,
                location_id = $4,
                max_participants = $5
            WHERE id = $6`,
            [title, description, event_date, location_id, max_participants, eventId]
        );

        res.redirect('/admin/dashboard#events');
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.status(500).render('error', { message: 'Ошибка обновления мероприятия' });
    }
});

router.post('/locations', isAdmin, async (req, res) => {
    try {
        const { city_id, metro_station, address } = req.body;
        await db.query(
            'INSERT INTO locations (city_id, metro_station, address) VALUES ($1, $2, $3)',
            [city_id, metro_station, address]
        );
        res.redirect('/admin/dashboard#locations');
    } catch (err) {
        console.error('Ошибка добавления локации:', err);
        res.status(500).send('Ошибка добавления локации: ' + err.message);
    }
});

// Обновление локации
router.post('/locations/update', isAdmin, async (req, res) => {
    try {
        const { 
            locationId,
            metro_station,
            address 
        } = req.body;

        await db.query(
            `UPDATE locations SET
                metro_station = $1,
                address = $2
            WHERE id = $3`,
            [metro_station, address, locationId]
        );

        res.redirect('/admin/dashboard#locations');
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.status(500).render('error', { message: 'Ошибка обновления локации' });
    }
});

// Получение списка для подтверждения
router.get('/attendance/:eventId', isAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                u.id,
                u.first_name,
                u.last_name,
                ue.attended
            FROM user_events ue
            JOIN users u ON ue.user_id = u.id
            WHERE ue.event_id = $1
            ORDER BY u.last_name
        `, [req.params.eventId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление статуса посещения
router.post('/attendance/:eventId', isAdmin, async (req, res) => {
    try {
        const { userIds } = req.body;
        await db.query(`
            UPDATE user_events
            SET attended = CASE 
                WHEN user_id = ANY($1) THEN TRUE 
                ELSE FALSE 
            END
            WHERE event_id = $2
        `, [userIds, req.params.eventId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение списка городов
router.get('/cities', isAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM cities ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получение улиц по городу
router.get('/streets', isAdmin, async (req, res) => {
    try {
        const { city_id } = req.query;
        const result = await db.query('SELECT * FROM streets WHERE city_id = $1 ORDER BY name', [city_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получение тем мероприятий
router.get('/themes', isAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM event_themes ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Фильтрация для статистики
router.get('/statsfilter', isAdmin, async (req, res) => {
  try {
    const { city: cityFilter, theme: themeFilter, period: periodFilter } = req.query;

    // Массивы для параметров каждого запроса
    const pastEventsParams = [];
    const upcomingEventsParams = [];
    const topEventsParams = [];

    // Базовые запросы
    let pastEventsQuery = `SELECT e.*, l.name AS location_name, t.name AS theme_name, c.name AS city_name
                           FROM events e
                           JOIN locations l ON e.location_id = l.id
                           JOIN themes t ON e.theme_id = t.id
                           JOIN cities c ON l.city_id = c.id
                           WHERE e.event_date < NOW()`;

    let upcomingEventsQuery = `SELECT e.*, l.name AS location_name, t.name AS theme_name, c.name AS city_name
                               FROM events e
                               JOIN locations l ON e.location_id = l.id
                               JOIN themes t ON e.theme_id = t.id
                               JOIN cities c ON l.city_id = c.id
                               WHERE e.event_date >= NOW()`; // Для будущих событий обычно >= NOW()

    let topEventsQuery = `SELECT e.*, COUNT(ue.user_id) AS participants_count, l.name AS location_name, t.name AS theme_name, c.name AS city_name
                          FROM events e
                          LEFT JOIN user_events ue ON e.id = ue.event_id
                          JOIN locations l ON e.location_id = l.id
                          JOIN themes t ON e.theme_id = t.id
                          JOIN cities c ON l.city_id = c.id
                          GROUP BY e.id, l.name, t.name, c.name
                          ORDER BY participants_count DESC`;


    let paramIndexPast = 1;
    let paramIndexUpcoming = 1;
    let paramIndexTop = 1;

    // ОБРАБОТКА ФИЛЬТРА ГОРОДА
    if (cityFilter && cityFilter !== 'all') {
      const cityId = parseInt(cityFilter, 10); // Преобразуем в число
      if (!isNaN(cityId)) { // Убедимся, что это валидный ID
        pastEventsQuery += ` AND c.id = $${paramIndexPast}`;
        pastEventsParams.push(cityId);
        paramIndexPast++;

        upcomingEventsQuery += ` AND c.id = $${paramIndexUpcoming}`;
        upcomingEventsParams.push(cityId);
        paramIndexUpcoming++;

        topEventsQuery += ` AND c.id = $${paramIndexTop}`;
        topEventsParams.push(cityId);
        paramIndexTop++;
      }
    }

    // ОБРАБОТКА ФИЛЬТРА ТЕМЫ (если есть)
    if (themeFilter && themeFilter !== 'all') {
      const themeId = parseInt(themeFilter, 10);
      if (!isNaN(themeId)) {
        pastEventsQuery += ` AND t.id = $${paramIndexPast}`;
        pastEventsParams.push(themeId);
        paramIndexPast++;

        upcomingEventsQuery += ` AND t.id = $${paramIndexUpcoming}`;
        upcomingEventsParams.push(themeId);
        paramIndexUpcoming++;

        topEventsQuery += ` AND t.id = $${paramIndexTop}`;
        topEventsParams.push(themeId);
        paramIndexTop++;
      }
    }

    // ОБРАБОТКА ФИЛЬТРА ПЕРИОДА (если есть)
    // Эта логика может быть сложнее, в зависимости от того, что означает 'periodFilter'
    // Например, если 'periodFilter' это 'last_week', 'last_month', 'last_year'
    if (periodFilter && periodFilter !== 'all') {
        const now = new Date();
        let startDate;

        if (periodFilter === 'last_week') {
            startDate = new Date(now.setDate(now.getDate() - 7));
        } else if (periodFilter === 'last_month') {
            startDate = new Date(now.setMonth(now.getMonth() - 1));
        } else if (periodFilter === 'last_year') {
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        }

        if (startDate) {
            pastEventsQuery += ` AND e.event_date >= $${paramIndexPast}`;
            pastEventsParams.push(startDate);
            paramIndexPast++;

            upcomingEventsQuery += ` AND e.event_date >= $${paramIndexUpcoming}`;
            upcomingEventsParams.push(startDate);
            paramIndexUpcoming++;

            topEventsQuery += ` AND e.event_date >= $${paramIndexTop}`;
            topEventsParams.push(startDate);
            paramIndexTop++;
        }
    }


    // Выполнение запросов с параметрами
    const [pastEvents, upcomingEvents, topEvents, themes, cities] = await Promise.all([
      db.query(pastEventsQuery, pastEventsParams),
      db.query(upcomingEventsQuery, upcomingEventsParams),
      db.query(topEventsQuery, topEventsParams),
      db.query('SELECT * FROM themes ORDER BY name ASC'),
      db.query('SELECT * FROM cities ORDER BY name ASC')
    ]);

    // ... (остальной код, рендер страницы) ...

  } catch (err) {
    console.error('Ошибка при фильтрации данных:', err);
    res.status(500).send('Ошибка при получении отфильтрованных данных.');
  }
});

module.exports = router;
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

// Главная админ-панель
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const [users, events, locations] = await Promise.all([
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
      db.query('SELECT * FROM locations ORDER BY metro_station'),
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
          COUNT(ue.user_id)::int as participants,
          SUM(CASE WHEN ue.attended THEN 1 ELSE 0 END)::int as attended_count
      FROM events e
      LEFT JOIN user_events ue ON e.id = ue.event_id
      WHERE e.event_date < NOW()
      GROUP BY e.id
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
      topEvents: topEvents.rows
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
    const { title, description, event_date, location_id, max_participants } = req.body;
    
    await db.query(
      `INSERT INTO events 
      (title, description, event_date, location_id, max_participants)
      VALUES ($1, $2, $3, $4, $5)`,
      [title, description, event_date, location_id, max_participants]
    );
    
    res.redirect('/admin/dashboard#events');
  } catch (err) {
    console.error('Ошибка создания мероприятия:', err);
    res.status(500).render('error', { message: 'Ошибка создания мероприятия' });
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
router.post('/locations', isAdmin, async (req, res) => {
  try {
    const { metro_station, address } = req.body;
    await db.query(
      'INSERT INTO locations (metro_station, address) VALUES ($1, $2)',
      [metro_station, address]
    );
    res.redirect('/admin/dashboard#locations');
  } catch (err) {
    console.error('Ошибка добавления локации:', err);
    res.status(500).render('error', { message: 'Ошибка добавления локации' });
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

module.exports = router;
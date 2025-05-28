const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { validationResult } = require('express-validator');

class UserController {
  // Регистрация пользователя
  static async create(userData) {
  const hashedPassword = await bcrypt.hash(userData.password, 12);
  const result = await db.query(
    `INSERT INTO users (
      first_name, 
      last_name, 
      patronymic, 
      birth_date,  
      email,
      confirmed,  
      phone, 
      telegram, 
      password_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
    RETURNING id, first_name, last_name, email`,
    [
      userData.first_name,
      userData.last_name,
      userData.patronymic || null,
      userData.birth_date,  // <-- Получаем из формы
      userData.email,
      userData.confirmed || false,
      userData.phone || null,
      userData.telegram || null,
      hashedPassword
    ]
  );
  return result.rows[0];
}

  // Поиск пользователя по email
  static async findByEmail(email) {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  // Проверка пароля
  static async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }
}

// Валидация регистрации
const validateRegistration = [
  // Добавьте валидаторы для обязательных полей
];

// Рендеринг формы входа
router.get('/login', (req, res) => {
  res.render('login', {
    title: 'Вход',
    error: req.session.error,
    formData: req.session.formData || {}
  });
  // Очистка данных после рендеринга
  req.session.error = null;
  req.session.formData = null;
});

// Рендеринг формы регистрации
router.get('/register', (req, res) => {
  res.render('register', {
    title: 'Регистрация',
    error: req.session.error,
    formData: req.session.formData || {}
  });
  // Очистка данных после рендеринга
  req.session.error = null;
  req.session.formData = null;
});

// Обработка регистрации
router.post('/register', validateRegistration, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = errors.array()[0].msg;
    req.session.formData = req.body;
    return res.redirect('/users/register');
  }

  try {
    const user = await UserController.create(req.body);
    req.session.user = {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email
    };
    res.redirect('/users/profile');
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      req.session.error = 'Пользователь с таким email уже существует';
    } else {
      req.session.error = 'Ошибка регистрации';
    }
    req.session.formData = req.body;
    res.redirect('/users/register');
  }
});

// Авторизация
// Авторизация
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Сначала проверяем администратора
    const adminResult = await db.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      const validAdminPassword = await bcrypt.compare(password, admin.password_hash);
      
      if (validAdminPassword) {
        req.session.admin = {
          id: admin.id,
          email: admin.email
        };
        return res.redirect('/admin/dashboard');
      }
    }

    // Если не администратор, проверяем пользователя
    const user = await UserController.findByEmail(email);
    if (!user || !(await UserController.comparePassword(password, user.password_hash))) {
      req.session.error = 'Неверный email или пароль';
      req.session.formData = req.body;
      return res.redirect('/users/login');
    }

    req.session.user = {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email
    };

    res.redirect(user.confirmed ? '/users/profile');
   

  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка сервера');
  }

});

// Профиль пользователя
router.get('/profile', async (req, res) => {
  // Проверка авторизации
  if (!req.session.user) {
    return res.redirect('/users/login');
  }

  try {
    // 1. Получаем данные пользователя
    const userQuery = await db.query(
      `SELECT 
        first_name, 
        last_name, 
        patronymic, 
        TO_CHAR(birth_date, 'YYYY-MM-DD') AS birth_date,
        email,
        phone,
        telegram,
        confirmed 
       FROM users 
       WHERE id = $1`,
      [req.session.user.id]
    );

    // Если пользователь не найден
    if (userQuery.rows.length === 0) {
      req.session.destroy();
      return res.redirect('/users/login');
    }

    const user = userQuery.rows[0];

    // 2. Получаем мероприятия пользователя
    const eventsQuery = await db.query(
      `SELECT 
        e.title,
        e.event_date AS event_date_raw,
        TO_CHAR(e.event_date, 'DD.MM.YYYY HH24:MI') AS event_date_formatted,
        l.metro_station,
        l.address,
        ue.attended
       FROM user_events ue
       JOIN events e ON ue.event_id = e.id
       JOIN locations l ON e.location_id = l.id
       WHERE ue.user_id = $1
       ORDER BY e.event_date DESC`,
      [req.session.user.id]
    );

    // 3. Формируем данные для шаблона
    const templateData = {
      title: 'Личный кабинет',
      user: {
        ...user,
        // Форматирование отчества (если есть)
        patronymic: user.patronymic || 'Не указано'
      },
      events: eventsQuery.rows,
      isVerified: user.confirmed,
      helpers: {
        // Функция для форматирования телефона
        formatPhone: (phone) => {
          if (!phone) return 'Не указан';
          return phone.replace(/(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})/, '+$1 ($2) $3-$4-$5');
        }
      }
    };

    // 4. Рендерим шаблон
    res.render('profile', templateData);

  } catch (err) {
    console.error('Ошибка загрузки профиля:', err);
    res.status(500).render('error', {
      title: 'Ошибка',
      message: 'Не удалось загрузить данные профиля'
    });
  }
});


// Обновление данных пользователя
router.post('/update', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    try {
        const userId = req.session.user.id;
        const {
            first_name,
            last_name,
            patronymic,
            birth_date,
            email,
            phone,
            telegram,
            password
        } = req.body;

        // Обновление пароля, если указан
        let hashedPassword;
        if (password) {
            hashedPassword = await bcrypt.hash(password, 12);
        }

        const updateQuery = `
            UPDATE users SET
                first_name = $1,
                last_name = $2,
                patronymic = $3,
                birth_date = $4,
                email = $5,
                phone = $6,
                telegram = $7
                ${password ? ', password_hash = $8' : ''}
            WHERE id = ${password ? '$9' : '$8'}
            RETURNING *
        `;

        const params = [
            first_name,
            last_name,
            patronymic || null,
            new Date(birth_date),
            email,
            phone || null,
            telegram || null,
            ...(password ? [hashedPassword, userId] : [userId])
        ];

        const result = await db.query(updateQuery, params);
        
        // Обновляем сессию
        req.session.user = {
            ...req.session.user,
            ...result.rows[0]
        };

        res.redirect('/users/profile');

    } catch (err) {
        console.error('Ошибка обновления:', err);
        res.status(500).send('Ошибка сервера');
    }
});

// Выход
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
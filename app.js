const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();

// Настройка EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Встроенные middleware Express
app.use(express.urlencoded({ extended: true })); // Парсинг данных форм
app.use(express.json()); // Парсинг JSON
app.use(express.static(path.join(__dirname, 'public'))); // Статические файлы

// Настройка сессий PostgreSQL
app.use(session({
  store: new pgSession({ pool: db }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// Передача данных в шаблоны
// app.js (в мидлваре передачи данных)
app.use(async (req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.admin = req.session.admin;
  // Загружаем города из БД
  const cities = await db.query('SELECT * FROM cities');
  res.locals.cities = cities.rows; 
  res.locals.sessionCity = req.session.city_id; // ID выбранного города
  next();
});

// Роуты
const routes = [
  { path: '/', file: './routes/index' },
  { path: '/users', file: './routes/users' },
  { path: '/events', file: './routes/events' },
  { path: '/admin', file: './routes/admin' },
  { path: '/about', file: './routes/about' }
];

routes.forEach(route => {
  try {
    const router = require(route.file);
    app.use(route.path, router);
  } catch (e) {
    console.error(`Ошибка загрузки роута ${route.file}:`, e.message);
  }
});

// Обработка 404
app.use(async (req, res) => {
    try {
        // Получаем список городов
        const cities = await db.query('SELECT * FROM cities');
        
        res.status(404).render('partials/404', {
            title: 'Страница не найдена',
            cities: cities.rows,
            sessionCity: req.session.city_id || null
        });
    } catch (err) {
        console.error('Ошибка загрузки данных:', err);
        res.status(500).send('Ошибка сервера');
    }
});

// Получение списка городов для всех страниц
app.use(async (req, res, next) => {
    try {
        const cities = await db.query('SELECT * FROM cities');
        res.locals.cities = cities.rows;
        res.locals.sessionCity = req.session.city_id || null;
        next();
    } catch (err) {
        console.error('Ошибка загрузки городов:', err);
        next();
    }
});

// Обработка выбора города (POST)
app.post("/set-city", async (req, res) => {
  try {
    const cityId = parseInt(req.body.city, 10);

    // Проверка существования города
    const result = await db.query('SELECT id FROM cities WHERE id = $1', [cityId]);
    if (!result.rows.length) {
      return res.status(400).redirect('back');
    }

    // Сохраняем ID города в сессии
    req.session.city_id = cityId;
    res.redirect(req.headers.referer || "/");
    
  } catch (err) {
    console.error('Ошибка выбора города:', err);
    res.status(500).redirect('/');
  }
});
// Блокировка GET-запросов
app.get("/set-city", (req, res) => {
  res.redirect("/"); // Перенаправляем на главную
});
// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
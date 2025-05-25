// routes/index.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const selectedCityId = req.session.city_id;
        
        // Получаем локации для выбранного города
        const locationsQuery = selectedCityId 
            ? 'SELECT * FROM locations WHERE city_id = $1'
            : 'SELECT * FROM locations ORDER BY id';
            
        const locations = await db.query(
            locationsQuery, 
            selectedCityId ? [selectedCityId] : []
        );

        res.render('index', {
            title: 'Главная',
            stylesheet: '/css/style.css',
            user: req.session.user || null,
            locations: locations.rows,
            cities: (await db.query('SELECT * FROM cities')).rows,
            sessionCity: selectedCityId
        });

    } catch (err) {
        console.error('Ошибка получения данных:', err);
        res.status(500).send('Ошибка сервера');
    }
});

router.post('/set-city', async (req, res) => {
  const { city } = req.body;
  req.session.city_id = city; // Сохраняем ID города в сессии
  const previousUrl = req.headers.referer || "/";
  res.redirect(previousUrl); // Возвращаем пользователя на предыдущую страницу
});

module.exports = router;
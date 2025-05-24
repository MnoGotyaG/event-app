const express = require('express');
const router = express.Router();
const db = require('../db');

// Страница "О нас" с отзывами
// routes/about.js
router.get('/', async (req, res) => {
    try {
        // Получаем города
        const citiesResult = await db.query('SELECT * FROM cities');
        
        // Получаем отзывы
        const reviews = await db.query(`
            SELECT r.*, u.first_name, u.last_name 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            ORDER BY r.created_at DESC
        `);
        
        res.render('about', {
            reviews: reviews.rows,
            cities: citiesResult.rows, // Передаем города
            user: req.session.user,
            error: req.session.error,
            sessionCity: req.session.city_id // Добавляем сессию города
        });
        
        req.session.error = null;
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// Добавление отзыва
router.post('/', async (req, res) => {
    try {
        const { reviewText, rating } = req.body;
        
        await db.query(
            'INSERT INTO reviews (user_id, review_text, rating) VALUES ($1, $2, $3)',
            [req.session.user.id, reviewText, rating]
        );
        
        res.redirect('/about');
    } catch (err) {
        req.session.error = 'Ошибка при сохранении отзыва';
        res.redirect('/about');
    }
});

module.exports = router;
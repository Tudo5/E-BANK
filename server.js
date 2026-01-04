const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const app = express();
const PORT = 3000;

// ====== ИНИЦИАЛИЗАЦИЯ БД ======
const db = new sqlite3.Database('./bank.db');

db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        balance INTEGER DEFAULT 1000 CHECK(balance >= 0),
        clicks INTEGER DEFAULT 0,
        click_power INTEGER DEFAULT 1,
        crypto_balance REAL DEFAULT 0,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        auto_clicker INTEGER DEFAULT 0,
        mining_farm INTEGER DEFAULT 0,
        mining_power INTEGER DEFAULT 0,
        total_earned INTEGER DEFAULT 0,
        daily_streak INTEGER DEFAULT 0,
        last_daily DATE,
        lottery_tickets INTEGER DEFAULT 0,
        achievements TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER DEFAULT 0,
        deleted_at DATETIME,
        deleted_by TEXT
    )`);

    // Банковские карты
    db.run(`CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        number TEXT UNIQUE NOT NULL,
        expires TEXT NOT NULL,
        cvv TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Вклады
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accrual DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Кредиты
    db.run(`CREATE TABLE IF NOT EXISTS credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        interest_rate REAL DEFAULT 0.1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_payment DATE,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Крипто-активы
    db.run(`CREATE TABLE IF NOT EXISTS crypto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        coin_type TEXT NOT NULL,
        amount REAL NOT NULL,
        buy_price REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // История операций
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Лотерея
    db.run(`CREATE TABLE IF NOT EXISTS lottery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        win_amount INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Логи админ-действий
    db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_user TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(admin_id) REFERENCES users(id)
    )`);

    // Удаленные пользователи (архив)
    db.run(`CREATE TABLE IF NOT EXISTS deleted_users (
        id INTEGER PRIMARY KEY,
        login TEXT NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        balance INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        click_power INTEGER DEFAULT 1,
        level INTEGER DEFAULT 1,
        exp INTEGER DEFAULT 0,
        total_earned INTEGER DEFAULT 0,
        created_at DATETIME,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_by TEXT,
        deleted_reason TEXT
    )`);

    console.log('✅ Таблицы БД созданы/проверены');
});

// ====== СЕКРЕТНЫЙ АККАУНТ ILIA ======
function checkAndCreateSecretAccount() {
    const secretLogin = 'ILIA';
    const secretPassword = 'Tudo228';
    const secretName = 'Илья Бог';

    db.get('SELECT id FROM users WHERE login = ?', [secretLogin], (err, existing) => {
        if (!err && !existing) {
            bcrypt.hash(secretPassword, 10, (hashErr, hashedPassword) => {
                if (!hashErr) {
                    db.run(`INSERT INTO users (login, password, name, balance, level, click_power, auto_clicker, total_earned) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [secretLogin, hashedPassword, secretName, 50000, 50, 50, 1, 100000],
                        function (insertErr) {
                            if (!insertErr) {
                                console.log('🔮 Секретный аккаунт ILIA создан!');
                                // Создаем крипто-портфель
                                db.run('INSERT INTO crypto (user_id, coin_type, amount, buy_price) VALUES (?, "BTC", 0.5, 45000)',
                                    [this.lastID]);
                                db.run('INSERT INTO crypto (user_id, coin_type, amount, buy_price) VALUES (?, "ETH", 5, 2800)',
                                    [this.lastID]);
                            }
                        }
                    );
                }
            });
        }
    });
}

// Запускаем проверку при старте
setTimeout(checkAndCreateSecretAccount, 1000);

// ====== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======
function generateCardNumber() {
    const part = () => Math.floor(1000 + Math.random() * 9000);
    return `${part()} ${part()} ${part()} ${part()}`;
}

function generateCardExpiry() {
    const now = new Date();
    const year = now.getFullYear() + 3;
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${month}/${year.toString().slice(2)}`;
}

function generateCVV() {
    return Math.floor(100 + Math.random() * 900).toString();
}

function getRandomCryptoPrice(coin) {
    const basePrices = {
        'BTC': 50000 + Math.random() * 10000,
        'ETH': 3000 + Math.random() * 1000,
        'DOGE': 0.15 + Math.random() * 0.1,
        'SOL': 100 + Math.random() * 50
    };
    const base = basePrices[coin] || 100;
    return Math.floor(base * 100) / 100;
}

// ====== МИДЛВАРЫ ======
app.use(express.json());
app.use(express.static('.'));
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url}`);
    next();
});

// ====== СЕССИИ ======
const sessions = {};
const activeUsers = {};

// ====== АУТЕНТИФИКАЦИЯ ======
app.post('/api/login', async (req, res) => {
    try {
        const { login, password } = req.body;

        if (!login || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        db.get('SELECT * FROM users WHERE login = ? AND deleted = 0', [login], async (err, user) => {
            if (err) {
                console.error('Login error:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Пользователь не найден или удален' });
            }

            const passwordValid = await bcrypt.compare(password, user.password);
            if (!passwordValid) {
                return res.status(401).json({ error: 'Неверный пароль' });
            }

            const today = new Date().toISOString().split('T')[0];
            let newStreak = user.daily_streak || 0;

            if (user.last_daily !== today) {
                const lastDaily = user.last_daily ? new Date(user.last_daily) : null;
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0, 0, 0, 0);

                if (!lastDaily || lastDaily < yesterday) {
                    newStreak = 1;
                } else {
                    newStreak += 1;
                }

                db.run('UPDATE users SET last_daily = ?, daily_streak = ? WHERE id = ?',
                    [today, newStreak, user.id]);
            }

            const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
            sessions[token] = user.id;
            activeUsers[user.id] = {
                token: token,
                login: user.login,
                lastActive: Date.now()
            };

            let achievements = [];
            try {
                achievements = JSON.parse(user.achievements || '[]');
            } catch (e) {
                achievements = [];
            }

            res.json({
                token,
                login: user.login,
                name: user.name,
                balance: user.balance,
                clicks: user.clicks,
                click_power: user.click_power,
                level: user.level,
                exp: user.exp,
                auto_clicker: user.auto_clicker,
                mining_farm: user.mining_farm,
                mining_power: user.mining_power,
                total_earned: user.total_earned,
                daily_streak: newStreak,
                last_daily: user.last_daily,
                lottery_tickets: user.lottery_tickets,
                achievements: achievements,
                isSpecial: user.login === 'ILIA'
            });
        });
    } catch (error) {
        console.error('Login exception:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { login, password, name } = req.body;

        if (!login || !password || !name) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        if (login.length < 3) {
            return res.status(400).json({ error: 'Логин должен быть не менее 3 символов' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
        }

        db.get('SELECT id FROM users WHERE login = ? AND deleted = 0', [login], async (err, existingUser) => {
            if (err) {
                console.error('Register check error:', err);
                return res.status(500).json({ error: 'Ошибка проверки пользователя' });
            }

            if (existingUser) {
                return res.status(400).json({ error: 'Логин уже занят' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const startAchievements = JSON.stringify(['first_login', 'newbie']);

            db.run(`INSERT INTO users (login, password, name, achievements) VALUES (?, ?, ?, ?)`,
                [login, hashedPassword, name, startAchievements],
                function (err) {
                    if (err) {
                        console.error('Register insert error:', err);
                        return res.status(500).json({ error: 'Ошибка создания пользователя' });
                    }

                    const userId = this.lastID;
                    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
                    sessions[token] = userId;
                    activeUsers[userId] = {
                        token: token,
                        login: login,
                        lastActive: Date.now()
                    };

                    const cardNumber = generateCardNumber();
                    const cardExpiry = generateCardExpiry();
                    const cardCVV = generateCVV();

                    db.run('INSERT INTO cards (user_id, number, expires, cvv) VALUES (?, ?, ?, ?)',
                        [userId, cardNumber, cardExpiry, cardCVV]);

                    db.run('INSERT INTO history (user_id, type, details) VALUES (?, "register", ?)',
                        [userId, 'Регистрация аккаунта']);

                    res.json({
                        token,
                        login,
                        name,
                        balance: 1000,
                        clicks: 0,
                        click_power: 1,
                        level: 1,
                        exp: 0,
                        auto_clicker: 0,
                        mining_farm: 0,
                        mining_power: 0,
                        daily_streak: 0,
                        lottery_tickets: 0,
                        achievements: ['first_login', 'newbie'],
                        message: 'Аккаунт успешно создан! Первая карта создана автоматически.'
                    });
                }
            );
        });
    } catch (error) {
        console.error('Register exception:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.split(' ')[1];
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }

    req.userId = sessions[token];

    if (activeUsers[req.userId]) {
        activeUsers[req.userId].lastActive = Date.now();
    }

    next();
}

// ====== ОСНОВНЫЕ API ЭНДПОИНТЫ ======

app.get('/api/me', authMiddleware, (req, res) => {
    db.get(`SELECT id, login, name, balance, clicks, click_power, level, exp, auto_clicker, 
                   mining_farm, mining_power, total_earned, daily_streak, last_daily, 
                   lottery_tickets, achievements, created_at 
            FROM users WHERE id = ? AND deleted = 0`,
        [req.userId],
        (err, user) => {
            if (err) {
                console.error('Me error:', err);
                return res.status(500).json({ error: 'Ошибка получения данных' });
            }

            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден или удален' });
            }

            try {
                user.achievements = JSON.parse(user.achievements || '[]');
            } catch (e) {
                user.achievements = [];
            }

            user.isSpecial = user.login === 'ILIA';

            res.json(user);
        }
    );
});

app.post('/api/click', authMiddleware, (req, res) => {
    db.get('SELECT click_power, level, exp, total_earned, clicks, balance FROM users WHERE id = ? AND deleted = 0',
        [req.userId], (err, user) => {
            if (err || !user) {
                console.error('Ошибка получения данных пользователя:', err);
                return res.status(500).json({ error: 'Ошибка получения данных' });
            }

            const earned = user.click_power;
            let newExp = user.exp + 1;
            let newLevel = user.level;
            let levelBonus = 0;
            let leveledUp = false;

            const expNeeded = newLevel * 100;

            if (newExp >= expNeeded) {
                newLevel += 1;
                levelBonus = newLevel * 50;
                newExp = newExp - expNeeded;
                leveledUp = true;
            }

            const totalEarned = earned + levelBonus;

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run(`UPDATE users 
                       SET clicks = clicks + 1, 
                           balance = balance + ?, 
                           exp = ?,
                           level = ?,
                           total_earned = total_earned + ?
                       WHERE id = ? AND deleted = 0`,
                    [totalEarned, newExp, newLevel, totalEarned, req.userId],
                    (err) => {
                        if (err) {
                            console.error('Ошибка обновления данных:', err);
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка обновления данных' });
                        }

                        db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "click", ?, ?)',
                            [req.userId, totalEarned, `Клик: +${totalEarned}₽`],
                            (err) => {
                                if (err) {
                                    console.error('Ошибка записи истории:', err);
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка записи истории' });
                                }

                                db.get('SELECT balance, clicks, level, exp FROM users WHERE id = ?',
                                    [req.userId], (err, updatedUser) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: 'Ошибка получения данных' });
                                        }

                                        db.run('COMMIT');
                                        res.json({
                                            success: true,
                                            earned: totalEarned,
                                            clicks: updatedUser.clicks,
                                            level: updatedUser.level,
                                            exp: updatedUser.exp,
                                            balance: updatedUser.balance,
                                            leveledUp: leveledUp,
                                            levelBonus: levelBonus,
                                            message: `+${totalEarned}₽! Кликов: ${updatedUser.clicks}`
                                        });
                                    });
                            });
                    });
            });
        });
});

app.post('/api/daily-bonus', authMiddleware, (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    db.get('SELECT daily_streak, last_daily FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }

        if (user.last_daily === today) {
            return res.status(400).json({ error: 'Вы уже получали бонус сегодня' });
        }

        const streak = user.daily_streak || 0;
        let newStreak = streak + 1;

        const baseBonus = 100;
        const streakBonus = Math.min(streak * 50, 500);
        const randomBonus = Math.floor(Math.random() * 100);
        const totalBonus = baseBonus + streakBonus + randomBonus;

        const ticketChance = Math.random();
        let ticketBonus = 0;
        if (ticketChance > 0.8) {
            ticketBonus = 1;
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(`UPDATE users 
                   SET balance = balance + ?, 
                       daily_streak = ?, 
                       last_daily = ?,
                       lottery_tickets = lottery_tickets + ?
                   WHERE id = ? AND deleted = 0`,
                [totalBonus, newStreak, today, ticketBonus, req.userId],
                (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка начисления бонуса' });
                    }

                    if (newStreak >= 7) {
                        db.get('SELECT achievements FROM users WHERE id = ?', [req.userId], (err, userData) => {
                            if (!err && userData) {
                                let achievements;
                                try {
                                    achievements = JSON.parse(userData.achievements || '[]');
                                } catch (e) {
                                    achievements = [];
                                }

                                if (!achievements.includes('weekly_streak')) {
                                    achievements.push('weekly_streak');
                                    db.run('UPDATE users SET achievements = ? WHERE id = ?',
                                        [JSON.stringify(achievements), req.userId]);
                                }
                            }
                        });
                    }

                    db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "daily_bonus", ?, ?)',
                        [req.userId, totalBonus, `Ежедневный бонус (streak: ${newStreak})`],
                        (err) => {
                            if (err) console.error('History error:', err);
                        });

                    db.get('SELECT balance, daily_streak, lottery_tickets FROM users WHERE id = ?',
                        [req.userId], (err, updatedUser) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка получения данных' });
                            }

                            db.run('COMMIT');
                            res.json({
                                success: true,
                                bonus: totalBonus,
                                streak: newStreak,
                                base: baseBonus,
                                streakBonus: streakBonus,
                                random: randomBonus,
                                ticket: ticketBonus > 0,
                                newBalance: updatedUser.balance,
                                newStreak: updatedUser.daily_streak,
                                tickets: updatedUser.lottery_tickets,
                                message: `Ежедневный бонус: +${totalBonus}₽! Streak: ${newStreak} дней`
                            });
                        });
                });
        });
    });
});

app.get('/api/leaderboard/:type', authMiddleware, (req, res) => {
    const { type } = req.params;
    const limit = 10;

    let orderBy;
    switch (type) {
        case 'balance':
            orderBy = 'balance DESC';
            break;
        case 'level':
            orderBy = 'level DESC, exp DESC';
            break;
        case 'clicks':
            orderBy = 'clicks DESC';
            break;
        case 'total':
            orderBy = 'total_earned DESC';
            break;
        default:
            orderBy = 'balance DESC';
    }

    db.all(`SELECT login, name, balance, clicks, level, exp, total_earned, 
                   mining_farm, created_at 
            FROM users 
            WHERE deleted = 0 AND login != 'admin' 
            ORDER BY ${orderBy} 
            LIMIT ?`,
        [limit],
        (err, leaders) => {
            if (err) {
                console.error('Leaderboard error:', err);
                return res.status(500).json({ error: 'Ошибка получения лидерборда' });
            }

            const leadersWithPosition = leaders.map((leader, index) => ({
                position: index + 1,
                ...leader,
                medal: index < 3 ? ['🥇', '🥈', '🥉'][index] : null
            }));

            res.json(leadersWithPosition);
        }
    );
});

app.post('/api/transfer', authMiddleware, (req, res) => {
    const { toLogin, amount } = req.body;
    const amountInt = parseInt(amount);

    if (!toLogin || !amountInt || amountInt <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    if (toLogin === 'ILIA') {
        return res.status(400).json({ error: 'Нельзя переводить властелину!' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.get('SELECT id, login, balance FROM users WHERE login = ? AND id != ? AND deleted = 0',
            [toLogin, req.userId], (err, receiver) => {
                if (err || !receiver) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ error: 'Получатель не найден' });
                }

                db.get('SELECT id, login, balance, total_earned FROM users WHERE id = ? AND deleted = 0',
                    [req.userId], (err, sender) => {
                        if (err || !sender) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка получения данных отправителя' });
                        }

                        if (sender.balance < amountInt) {
                            db.run('ROLLBACK');
                            return res.status(400).json({ error: 'Недостаточно средств' });
                        }

                        db.run('UPDATE users SET balance = balance - ?, total_earned = total_earned + ? WHERE id = ?',
                            [amountInt, amountInt, sender.id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка списания' });
                                }

                                db.run('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
                                    [amountInt, amountInt, receiver.id], (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: 'Ошибка зачисления' });
                                        }

                                        const senderMsg = `Перевод пользователю ${receiver.login}`;
                                        const receiverMsg = `Перевод от пользователя ${sender.login}`;

                                        db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, ?, ?, ?)',
                                            [sender.id, 'transfer', -amountInt, senderMsg], (err) => {
                                                if (err) console.error('History error sender:', err);
                                            });

                                        db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, ?, ?, ?)',
                                            [receiver.id, 'transfer', amountInt, receiverMsg], (err) => {
                                                if (err) console.error('History error receiver:', err);
                                            });

                                        db.get('SELECT balance, total_earned FROM users WHERE id = ?',
                                            [sender.id], (err, updatedUser) => {
                                                if (err) {
                                                    db.run('ROLLBACK');
                                                    return res.status(500).json({ error: 'Ошибка получения баланса' });
                                                }

                                                db.run('COMMIT');
                                                res.json({
                                                    success: true,
                                                    newBalance: updatedUser.balance,
                                                    totalEarned: updatedUser.total_earned,
                                                    message: `Перевод ${amountInt}₽ пользователю ${receiver.login} выполнен`
                                                });
                                            });
                                    });
                            });
                    });
            });
    });
});

app.post('/api/upgrade', authMiddleware, (req, res) => {
    const { type } = req.body;
    const upgradeCosts = {
        'power': 100,
        'auto': 500
    };

    if (!upgradeCosts[type]) {
        return res.status(400).json({ error: 'Неверный тип улучшения' });
    }

    const cost = upgradeCosts[type];

    db.get(`SELECT balance, click_power, auto_clicker
            FROM users WHERE id = ? AND deleted = 0`, [req.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }

        if (user.balance < cost) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        if (type === 'auto' && user.auto_clicker === 1) {
            return res.status(400).json({ error: 'Авто-кликер уже куплен' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            let updateQuery = '';
            let params = [];

            if (type === 'power') {
                updateQuery = 'UPDATE users SET balance = balance - ?, click_power = click_power + 2 WHERE id = ?';
                params = [cost, req.userId];
            } else if (type === 'auto') {
                updateQuery = 'UPDATE users SET balance = balance - ?, auto_clicker = 1 WHERE id = ?';
                params = [cost, req.userId];
            }

            db.run(updateQuery, params, (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Ошибка обновления' });
                }

                db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "upgrade", ?, ?)',
                    [req.userId, -cost, `Улучшение: ${type}`], (err) => {
                        if (err) console.error('History error:', err);

                        db.get(`SELECT balance, click_power, auto_clicker
                               FROM users WHERE id = ?`,
                            [req.userId], (err, updatedUser) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка получения данных' });
                                }

                                db.run('COMMIT');

                                let message = '';
                                if (type === 'power') {
                                    message = `Сила клика увеличена на 2! Теперь: ${updatedUser.click_power}₽ за клик`;
                                } else if (type === 'auto') {
                                    message = 'Авто-кликер куплен! Теперь вы будете получать автоматические клики каждые 10 секунд!';
                                }

                                res.json({
                                    success: true,
                                    newBalance: updatedUser.balance,
                                    click_power: updatedUser.click_power,
                                    auto_clicker: updatedUser.auto_clicker,
                                    message: message
                                });
                            });
                    });
            });
        });
    });
});

app.get('/api/cards', authMiddleware, (req, res) => {
    db.all('SELECT id, number, expires, cvv, created_at FROM cards WHERE user_id = ? ORDER BY created_at DESC',
        [req.userId],
        (err, cards) => {
            if (err) {
                console.error('Cards error:', err);
                return res.status(500).json({ error: 'Ошибка получения карт' });
            }
            res.json(cards || []);
        }
    );
});

app.post('/api/cards/new', authMiddleware, (req, res) => {
    const cardNumber = generateCardNumber();
    const cardExpiry = generateCardExpiry();
    const cardCVV = generateCVV();

    db.run('INSERT INTO cards (user_id, number, expires, cvv) VALUES (?, ?, ?, ?)',
        [req.userId, cardNumber, cardExpiry, cardCVV],
        function (err) {
            if (err) {
                console.error('New card error:', err);
                return res.status(500).json({ error: 'Ошибка создания карты' });
            }

            db.run('INSERT INTO history (user_id, type, details) VALUES (?, "card_create", ?)',
                [req.userId, `Создана карта: ${cardNumber}`]);

            res.json({
                success: true,
                card: {
                    id: this.lastID,
                    number: cardNumber,
                    expires: cardExpiry,
                    cvv: cardCVV
                },
                message: `Карта ${cardNumber} создана!`
            });
        }
    );
});

app.get('/api/deposits', authMiddleware, (req, res) => {
    db.all('SELECT id, amount, created_at, last_accrual FROM deposits WHERE user_id = ? ORDER BY created_at DESC',
        [req.userId],
        (err, deposits) => {
            if (err) {
                console.error('Deposits error:', err);
                return res.status(500).json({ error: 'Ошибка получения вкладов' });
            }

            const now = new Date();
            const depositsWithCurrent = (deposits || []).map(dep => {
                const lastAccrual = new Date(dep.last_accrual);
                const minutesPassed = Math.floor((now - lastAccrual) / (1000 * 60));
                const growthRate = 1.001;
                const currentAmount = Math.floor(dep.amount * Math.pow(growthRate, minutesPassed));
                const profit = currentAmount - dep.amount;

                return {
                    ...dep,
                    current_amount: currentAmount,
                    profit: profit,
                    minutes_passed: minutesPassed,
                    growth_percent: (profit / dep.amount * 100).toFixed(2)
                };
            });

            res.json(depositsWithCurrent);
        }
    );
});

app.post('/api/deposits/new', authMiddleware, (req, res) => {
    const { amount } = req.body;
    const amountInt = parseInt(amount);

    if (!amountInt || amountInt <= 0) {
        return res.status(400).json({ error: 'Некорректная сумма' });
    }

    if (amountInt > 1000000) {
        return res.status(400).json({ error: 'Слишком большая сумма (макс. 1,000,000₽)' });
    }

    db.get('SELECT balance FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }

        if (user.balance < amountInt) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                [amountInt, req.userId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка списания' });
                    }

                    db.run('INSERT INTO deposits (user_id, amount) VALUES (?, ?)',
                        [req.userId, amountInt], function (err) {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка создания вклада' });
                            }

                            const depositId = this.lastID;

                            db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "deposit_open", ?, ?)',
                                [req.userId, -amountInt, `Открыт вклад #${depositId} на ${amountInt}₽`],
                                (err) => {
                                    if (err) console.error('History error:', err);
                                });

                            db.get('SELECT balance FROM users WHERE id = ?', [req.userId], (err, updatedUser) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка получения баланса' });
                                }

                                db.run('COMMIT');
                                res.json({
                                    success: true,
                                    depositId: depositId,
                                    newBalance: updatedUser.balance,
                                    message: `Вклад на ${amountInt}₽ открыт! Начисление 0.1% в минуту`
                                });
                            });
                        });
                });
        });
    });
});

app.get('/api/credits', authMiddleware, (req, res) => {
    db.all('SELECT id, amount, remaining, interest_rate, created_at, next_payment FROM credits WHERE user_id = ? ORDER BY created_at DESC',
        [req.userId],
        (err, credits) => {
            if (err) {
                console.error('Credits error:', err);
                return res.status(500).json({ error: 'Ошибка получения кредитов' });
            }
            res.json(credits || []);
        }
    );
});

app.post('/api/credits/new', authMiddleware, (req, res) => {
    const { amount } = req.body;
    const amountInt = parseInt(amount);

    if (!amountInt || amountInt <= 0 || amountInt > 100000) {
        return res.status(400).json({ error: 'Некорректная сумма (1-100,000₽)' });
    }

    const interestRate = 0.1;
    const totalAmount = Math.floor(amountInt * (1 + interestRate));
    const nextPayment = new Date();
    nextPayment.setDate(nextPayment.getDate() + 30);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
            [amountInt, amountInt, req.userId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Ошибка выдачи кредита' });
                }

                db.run('INSERT INTO credits (user_id, amount, remaining, interest_rate, next_payment) VALUES (?, ?, ?, ?, ?)',
                    [req.userId, amountInt, totalAmount, interestRate, nextPayment.toISOString().split('T')[0]],
                    function (err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка создания кредита' });
                        }

                        db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "credit_taken", ?, ?)',
                            [req.userId, amountInt, `Взят кредит ${amountInt}₽ (вернуть ${totalAmount}₽)`],
                            (err) => {
                                if (err) console.error('History error:', err);
                            });

                        db.get('SELECT balance, total_earned FROM users WHERE id = ?', [req.userId], (err, updatedUser) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка получения баланса' });
                            }

                            db.run('COMMIT');
                            res.json({
                                success: true,
                                newBalance: updatedUser.balance,
                                totalEarned: updatedUser.total_earned,
                                creditId: this.lastID,
                                totalToPay: totalAmount,
                                message: `Кредит ${amountInt}₽ получен! Вернуть: ${totalAmount}₽ до ${nextPayment.toLocaleDateString()}`
                            });
                        });
                    });
            });
    });
});

app.post('/api/credits/pay', authMiddleware, (req, res) => {
    const { creditId } = req.body;

    if (!creditId) {
        return res.status(400).json({ error: 'Укажите ID кредита' });
    }

    db.get('SELECT id, remaining FROM credits WHERE id = ? AND user_id = ?', [creditId, req.userId], (err, credit) => {
        if (err) {
            console.error('Pay credit error:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }

        if (!credit) {
            return res.status(404).json({ error: 'Кредит не найден' });
        }

        db.get('SELECT balance FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
            if (err || !user) {
                return res.status(500).json({ error: 'Ошибка получения данных пользователя' });
            }

            if (user.balance < credit.remaining) {
                return res.status(400).json({ error: 'Недостаточно средств для погашения' });
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                    [credit.remaining, req.userId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка списания средств' });
                        }

                        db.run('DELETE FROM credits WHERE id = ? AND user_id = ?',
                            [credit.id, req.userId], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка удаления кредита' });
                                }

                                db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "credit_paid", ?, ?)',
                                    [req.userId, -credit.remaining, `Погашен кредит #${credit.id}`],
                                    (err) => {
                                        if (err) console.error('History error:', err);
                                    });

                                db.get('SELECT balance FROM users WHERE id = ?', [req.userId], (err, updatedUser) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: 'Ошибка получения баланса' });
                                    }

                                    db.run('COMMIT');
                                    res.json({
                                        success: true,
                                        newBalance: updatedUser.balance,
                                        message: `Кредит #${credit.id} погашен!`
                                    });
                                });
                            });
                    });
            });
        });
    });
});

app.get('/api/crypto/prices', authMiddleware, (req, res) => {
    const cryptoPrices = {
        'BTC': getRandomCryptoPrice('BTC'),
        'ETH': getRandomCryptoPrice('ETH'),
        'DOGE': getRandomCryptoPrice('DOGE'),
        'SOL': getRandomCryptoPrice('SOL')
    };
    res.json(cryptoPrices);
});

app.get('/api/crypto/portfolio', authMiddleware, (req, res) => {
    db.all('SELECT coin_type, amount, buy_price FROM crypto WHERE user_id = ?',
        [req.userId],
        (err, portfolio) => {
            if (err) {
                console.error('Portfolio error:', err);
                return res.status(500).json({ error: 'Ошибка получения портфеля' });
            }
            res.json(portfolio || []);
        }
    );
});

app.post('/api/crypto/buy', authMiddleware, (req, res) => {
    const { coin, amount, price } = req.body;
    const amountNum = parseFloat(amount);
    const priceNum = parseFloat(price);

    if (!coin || !amountNum || !priceNum || amountNum <= 0 || priceNum <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    const totalCost = Math.floor(amountNum * priceNum);

    db.get('SELECT balance FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
        if (err || !user) {
            console.error('Ошибка получения данных пользователя:', err);
            return res.status(500).json({ error: 'Ошибка получения данных пользователя' });
        }

        if (user.balance < totalCost) {
            return res.status(400).json({ error: `Недостаточно средств. Нужно: ${totalCost}₽, есть: ${user.balance}₽` });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run('UPDATE users SET balance = balance - ? WHERE id = ?',
                [totalCost, req.userId], (err) => {
                    if (err) {
                        console.error('Ошибка списания средств:', err);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка списания средств' });
                    }

                    db.get('SELECT id, amount, buy_price FROM crypto WHERE user_id = ? AND coin_type = ?',
                        [req.userId, coin], (err, existingCrypto) => {
                            if (err) {
                                console.error('Ошибка проверки крипты:', err);
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка проверки крипты' });
                            }

                            if (existingCrypto) {
                                const newAmount = existingCrypto.amount + amountNum;
                                const totalCostOld = existingCrypto.amount * existingCrypto.buy_price;
                                const totalCostNew = amountNum * priceNum;
                                const avgPrice = (totalCostOld + totalCostNew) / newAmount;

                                db.run('UPDATE crypto SET amount = ?, buy_price = ? WHERE id = ?',
                                    [newAmount, avgPrice, existingCrypto.id], (err) => {
                                        if (err) {
                                            console.error('Ошибка обновления крипты:', err);
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: 'Ошибка обновления крипты' });
                                        }
                                        completeTransaction();
                                    });
                            } else {
                                db.run('INSERT INTO crypto (user_id, coin_type, amount, buy_price) VALUES (?, ?, ?, ?)',
                                    [req.userId, coin, amountNum, priceNum], (err) => {
                                        if (err) {
                                            console.error('Ошибка создания крипты:', err);
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: 'Ошибка создания крипты' });
                                        }
                                        completeTransaction();
                                    });
                            }

                            function completeTransaction() {
                                db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "crypto_buy", ?, ?)',
                                    [req.userId, -totalCost, `Куплено ${amountNum.toFixed(4)} ${coin} по ${priceNum}₽`],
                                    (err) => {
                                        if (err) console.error('Ошибка записи истории:', err);
                                    });

                                db.get('SELECT balance FROM users WHERE id = ?', [req.userId], (err, updatedUser) => {
                                    if (err) {
                                        console.error('Ошибка получения баланса:', err);
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: 'Ошибка получения баланса' });
                                    }

                                    db.run('COMMIT', (err) => {
                                        if (err) {
                                            console.error('Ошибка коммита:', err);
                                            return res.status(500).json({ error: 'Ошибка сохранения' });
                                        }

                                        res.json({
                                            success: true,
                                            newBalance: updatedUser.balance,
                                            message: `Куплено ${amountNum.toFixed(4)} ${coin} за ${totalCost}₽`
                                        });
                                    });
                                });
                            }
                        });
                });
        });
    });
});

app.post('/api/crypto/sell', authMiddleware, (req, res) => {
    const { coin, amount, price } = req.body;
    const amountNum = parseFloat(amount);
    const priceNum = parseFloat(price);

    if (!coin || !amountNum || !priceNum || amountNum <= 0 || priceNum <= 0) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    db.get('SELECT id, amount, buy_price FROM crypto WHERE user_id = ? AND coin_type = ?',
        [req.userId, coin], (err, crypto) => {
            if (err) {
                console.error('Sell crypto error:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (!crypto || crypto.amount < amountNum) {
                return res.status(400).json({ error: 'Недостаточно криптовалюты' });
            }

            const totalValue = Math.floor(amountNum * priceNum);
            const purchaseCost = crypto.buy_price * amountNum;
            const profit = totalValue - purchaseCost;

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run('UPDATE users SET balance = balance + ? WHERE id = ?',
                    [totalValue, req.userId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка зачисления средств' });
                        }

                        if (crypto.amount === amountNum) {
                            db.run('DELETE FROM crypto WHERE id = ?', [crypto.id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка удаления крипты' });
                                }
                                completeTransaction();
                            });
                        } else {
                            const newAmount = crypto.amount - amountNum;
                            db.run('UPDATE crypto SET amount = ? WHERE id = ?',
                                [newAmount, crypto.id], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ error: 'Ошибка обновления крипты' });
                                    }
                                    completeTransaction();
                                });
                        }

                        function completeTransaction() {
                            const profitText = profit >= 0 ? `(+${profit}₽)` : `(${profit}₽)`;
                            db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "crypto_sell", ?, ?)',
                                [req.userId, totalValue, `Продано ${amountNum.toFixed(4)} ${coin} по ${priceNum}₽ ${profitText}`],
                                (err) => {
                                    if (err) console.error('History error:', err);
                                });

                            db.get('SELECT balance FROM users WHERE id = ?', [req.userId], (err, updatedUser) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Ошибка получения баланса' });
                                }

                                db.run('COMMIT');
                                res.json({
                                    success: true,
                                    newBalance: updatedUser.balance,
                                    profit: profit,
                                    message: `Продано ${amountNum.toFixed(4)} ${coin} за ${totalValue}₽`
                                });
                            });
                        }
                    });
            });
        }
    );
});

app.post('/api/lottery/buy', authMiddleware, (req, res) => {
    const { tickets } = req.body;
    const ticketsInt = parseInt(tickets) || 1;
    const ticketPrice = 100;
    const totalCost = ticketsInt * ticketPrice;

    if (ticketsInt < 1 || ticketsInt > 10) {
        return res.status(400).json({ error: 'Можно купить от 1 до 10 билетов' });
    }

    db.get('SELECT balance FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }

        if (user.balance < totalCost) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run('UPDATE users SET balance = balance - ?, lottery_tickets = lottery_tickets + ? WHERE id = ?',
                [totalCost, ticketsInt, req.userId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка покупки билетов' });
                    }

                    db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "lottery_buy", ?, ?)',
                        [req.userId, -totalCost, `Куплено ${ticketsInt} лотерейных билетов`],
                        (err) => {
                            if (err) console.error('History error:', err);
                        });

                    db.get('SELECT balance, lottery_tickets FROM users WHERE id = ?',
                        [req.userId], (err, updatedUser) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка получения данных' });
                            }

                            db.run('COMMIT');
                            res.json({
                                success: true,
                                newBalance: updatedUser.balance,
                                tickets: updatedUser.lottery_tickets,
                                message: `Куплено ${ticketsInt} лотерейных билетов за ${totalCost}₽`
                            });
                        });
                });
        });
    });
});

app.post('/api/lottery/play', authMiddleware, (req, res) => {
    db.get('SELECT lottery_tickets FROM users WHERE id = ? AND deleted = 0', [req.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }

        if (user.lottery_tickets < 1) {
            return res.status(400).json({ error: 'Нет лотерейных билетов' });
        }

        const random = Math.random();
        let winAmount = 0;
        let winType = 'проигрыш';

        if (random < 0.5) {
            winAmount = 0;
            winType = 'проигрыш';
        } else if (random < 0.8) {
            winAmount = Math.floor(100 + Math.random() * 400);
            winType = 'мелкий выигрыш';
        } else if (random < 0.95) {
            winAmount = Math.floor(500 + Math.random() * 1000);
            winType = 'средний выигрыш';
        } else if (random < 0.99) {
            winAmount = Math.floor(1500 + Math.random() * 3500);
            winType = 'крупный выигрыш';
        } else {
            winAmount = 10000;
            winType = 'ДЖЕКПОТ!';
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run('UPDATE users SET balance = balance + ?, lottery_tickets = lottery_tickets - 1 WHERE id = ?',
                [winAmount, req.userId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Ошибка обновления' });
                    }

                    db.run('INSERT INTO lottery (user_id, amount, win_amount) VALUES (?, 1, ?)',
                        [req.userId, winAmount], (err) => {
                            if (err) console.error('Lottery record error:', err);
                        });

                    db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "lottery", ?, ?)',
                        [req.userId, winAmount, `Лотерея: ${winType} ${winAmount > 0 ? `+${winAmount}₽` : ''}`],
                        (err) => {
                            if (err) console.error('History error:', err);
                        });

                    if (winType === 'ДЖЕКПОТ!') {
                        db.get('SELECT achievements FROM users WHERE id = ?',
                            [req.userId], (err, userData) => {
                                if (!err && userData) {
                                    let achievements;
                                    try {
                                        achievements = JSON.parse(userData.achievements || '[]');
                                    } catch {
                                        achievements = [];
                                    }

                                    if (!achievements.includes('lucky')) {
                                        achievements.push('lucky');
                                        db.run('UPDATE users SET achievements = ? WHERE id = ?',
                                            [JSON.stringify(achievements), req.userId]);
                                    }
                                }
                            });
                    }

                    db.get('SELECT balance, lottery_tickets FROM users WHERE id = ?',
                        [req.userId], (err, updatedUser) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Ошибка получения данных' });
                            }

                            db.run('COMMIT');
                            res.json({
                                success: true,
                                won: winAmount,
                                type: winType,
                                newBalance: updatedUser.balance,
                                tickets: updatedUser.lottery_tickets,
                                message: winAmount > 0
                                    ? `🎉 ${winType} Вы выиграли ${winAmount}₽!`
                                    : '😔 Не повезло... Попробуйте еще раз!'
                            });
                        });
                });
        });
    });
});

app.get('/api/history', authMiddleware, (req, res) => {
    const limit = 20;
    const beforeId = req.query.before_id;

    let query = 'SELECT * FROM history WHERE user_id = ?';
    const params = [req.userId];

    if (beforeId) {
        query += ' AND id < ?';
        params.push(beforeId);
    }

    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit + 1);

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('History error:', err);
            return res.status(500).json({ error: 'Ошибка получения истории' });
        }

        const hasMore = rows.length > limit;
        const result = hasMore ? rows.slice(0, limit) : rows;
        const lastId = result.length > 0 ? result[result.length - 1].id : null;

        res.json({
            operations: result || [],
            hasMore: hasMore,
            lastId: lastId
        });
    });
});

// ====== АДМИН ПАНЕЛЬ ======
function adminAuth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const userId = sessions[token];

    db.get('SELECT login FROM users WHERE id = ? AND deleted = 0', [userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Ошибка проверки пользователя' });
        }

        if (user.login !== 'ILIA') {
            return res.status(403).json({ error: 'Доступ запрещен. Только для ILIA' });
        }

        req.userId = userId;
        req.adminLogin = user.login;
        next();
    });
}

app.get('/api/admin/stats', adminAuth, (req, res) => {
    const stats = {};

    db.serialize(() => {
        db.get(`
            SELECT 
                COUNT(*) as total_users,
                SUM(balance) as total_balance,
                AVG(balance) as avg_balance,
                SUM(clicks) as total_clicks,
                SUM(total_earned) as total_earned_all,
                MAX(level) as max_level
            FROM users
            WHERE deleted = 0
        `, (err, data) => {
            if (!err && data) {
                stats.general = data;
            }

            db.get(`
                SELECT COUNT(*) as active_24h 
                FROM users 
                WHERE last_daily >= datetime('now', '-1 day') AND deleted = 0
            `, (err, activeData) => {
                if (!err && activeData) {
                    stats.active_users = activeData;
                }

                db.all(`
                    SELECT u.login, u.name, SUM(c.amount * c.buy_price) as crypto_value
                    FROM crypto c
                    JOIN users u ON c.user_id = u.id
                    WHERE u.deleted = 0
                    GROUP BY u.id
                    ORDER BY crypto_value DESC
                    LIMIT 3
                `, (err, cryptoTop) => {
                    if (!err && cryptoTop) {
                        stats.crypto_top = cryptoTop;
                    }

                    const now = Date.now();
                    const onlineUsers = Object.values(activeUsers).filter(user =>
                        (now - user.lastActive) < 300000
                    ).length;

                    stats.online = {
                        online_users: onlineUsers,
                        total_sessions: Object.keys(sessions).length
                    };

                    res.json({
                        success: true,
                        stats: stats,
                        timestamp: new Date().toISOString()
                    });
                });
            });
        });
    });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    let whereClause = 'deleted = 0';
    const params = [];

    if (req.query.search) {
        whereClause += ' AND (login LIKE ? OR name LIKE ?)';
        params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    if (req.query.min_balance) {
        whereClause += ' AND balance >= ?';
        params.push(parseInt(req.query.min_balance));
    }

    if (req.query.max_balance) {
        whereClause += ' AND balance <= ?';
        params.push(parseInt(req.query.max_balance));
    }

    db.all(`
        SELECT id, login, name, balance, clicks, level, exp, 
               mining_farm, mining_power, total_earned, daily_streak,
               created_at, last_daily
        FROM users
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения пользователей' });
        }

        db.get(`SELECT COUNT(*) as total FROM users WHERE ${whereClause}`, params, (err, countData) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка подсчета' });
            }

            res.json({
                success: true,
                users: users || [],
                pagination: {
                    page: page,
                    limit: limit,
                    total: countData?.total || 0,
                    pages: Math.ceil((countData?.total || 0) / limit)
                }
            });
        });
    });
});

app.get('/api/admin/users-full', adminAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    let whereClause = 'deleted = 0';
    const params = [];

    if (req.query.search) {
        whereClause += ' AND (login LIKE ? OR name LIKE ?)';
        params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    db.all(`
        SELECT id, login, password, name, balance, clicks, level, exp, 
               mining_farm, mining_power, total_earned, daily_streak,
               created_at, last_daily
        FROM users
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения пользователей' });
        }

        db.get(`SELECT COUNT(*) as total FROM users WHERE ${whereClause}`, params, (err, countData) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка подсчета' });
            }

            res.json({
                success: true,
                users: users || [],
                pagination: {
                    page: page,
                    limit: limit,
                    total: countData?.total || 0,
                    pages: Math.ceil((countData?.total || 0) / limit)
                }
            });
        });
    });
});

app.get('/api/admin/deleted-users', adminAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 20;

    db.all(`
        SELECT id, login, name, balance, clicks, level, total_earned,
               created_at, deleted_at, deleted_by
        FROM deleted_users
        ORDER BY deleted_at DESC
        LIMIT ?
    `, [limit], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения удаленных пользователей' });
        }

        res.json({
            success: true,
            users: users || [],
            total: users?.length || 0
        });
    });
});

app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
    const userId = req.params.id;

    if (!userId || userId === '1') {
        return res.status(400).json({ error: 'Нельзя удалить этого пользователя' });
    }

    db.get('SELECT * FROM users WHERE id = ? AND deleted = 0', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        let userWasOnline = false;
        let userToken = null;

        for (const [token, uid] of Object.entries(sessions)) {
            if (uid == userId) {
                userWasOnline = true;
                userToken = token;
                break;
            }
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(`
                INSERT INTO deleted_users 
                (id, login, password, name, balance, clicks, click_power, level, exp, 
                 total_earned, created_at, deleted_by)
                SELECT id, login, password, name, balance, clicks, click_power, level, exp,
                       total_earned, created_at, ?
                FROM users
                WHERE id = ?
            `, [req.adminLogin, userId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Ошибка архивирования пользователя' });
                }

                db.run('UPDATE users SET deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
                    [req.adminLogin, userId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Ошибка удаления пользователя' });
                        }

                        if (userToken && sessions[userToken]) {
                            delete sessions[userToken];
                            delete activeUsers[userId];
                        }

                        db.run(`
                            INSERT INTO admin_logs (admin_id, action, target_user, details) 
                            VALUES (?, ?, ?, ?)
                        `, [req.userId, 'delete_user', user.login, `Удаление пользователя. Онлайн: ${userWasOnline}`], (err) => {
                            if (err) console.error('Ошибка логирования:', err);
                        });

                        db.run('COMMIT', (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Ошибка сохранения изменений' });
                            }

                            res.json({
                                success: true,
                                deleted_user_id: userId,
                                user_was_online: userWasOnline,
                                message: `Пользователь ${user.login} удален! ${userWasOnline ? 'Сессия завершена.' : ''}`
                            });
                        });
                    });
            });
        });
    });
});

app.post('/api/admin/balance', adminAuth, (req, res) => {
    const { login, amount, operation } = req.body;

    if (!login || !amount || !operation) {
        return res.status(400).json({ error: 'Необходимо указать login, amount и operation (add/set)' });
    }

    const amountInt = parseInt(amount);
    if (isNaN(amountInt)) {
        return res.status(400).json({ error: 'Некорректная сумма' });
    }

    db.get('SELECT id, balance FROM users WHERE login = ? AND deleted = 0', [login], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        let newBalance;
        let updateQuery;

        if (operation === 'add') {
            newBalance = user.balance + amountInt;
            updateQuery = 'UPDATE users SET balance = balance + ? WHERE id = ?';
        } else if (operation === 'set') {
            newBalance = amountInt;
            updateQuery = 'UPDATE users SET balance = ? WHERE id = ?';
        } else {
            return res.status(400).json({ error: 'Некорректная операция. Используйте add или set' });
        }

        if (newBalance < 0) {
            return res.status(400).json({ error: 'Баланс не может быть отрицательным' });
        }

        db.run(updateQuery, operation === 'set' ? [amountInt, user.id] : [amountInt, user.id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Ошибка обновления баланса' });
            }

            db.run(`
                INSERT INTO admin_logs (admin_id, action, target_user, details) 
                VALUES (?, ?, ?, ?)
            `, [req.userId, 'balance_update', login, `${operation} ${amountInt}₽`], (err) => {
                if (err) console.error('Admin log error:', err);
            });

            res.json({
                success: true,
                login: login,
                old_balance: user.balance,
                new_balance: newBalance,
                operation: operation,
                amount: amountInt
            });
        });
    });
});

app.post('/api/admin/mass-give', adminAuth, (req, res) => {
    const { amount, message } = req.body;
    const amountInt = parseInt(amount);

    if (!amountInt || amountInt <= 0) {
        return res.status(400).json({ error: 'Некорректная сумма' });
    }

    db.run('UPDATE users SET balance = balance + ? WHERE deleted = 0 AND login != ?',
        [amountInt, 'ILIA'],
        function (err) {
            if (err) {
                return res.status(500).json({ error: 'Ошибка массового начисления' });
            }

            db.run(`
                INSERT INTO admin_logs (admin_id, action, details) 
                VALUES (?, ?, ?)
            `, [req.userId, 'mass_give', `${amountInt}₽ всем пользователям. Сообщение: ${message || 'Нет'}`], (err) => {
                if (err) console.error('Admin log error:', err);
            });

            res.json({
                success: true,
                amount: amountInt,
                affected_users: this.changes,
                total_given: amountInt * this.changes,
                message: `Начислено ${amountInt}₽ всем пользователям (${this.changes} чел.)`
            });
        }
    );
});

app.post('/api/admin/reset-leaderboard', adminAuth, (req, res) => {
    const { type } = req.body;

    let updateQuery;
    let params = [];

    switch (type) {
        case 'balance':
            updateQuery = 'UPDATE users SET balance = 1000 WHERE deleted = 0 AND login != ?';
            params = ['ILIA'];
            break;
        case 'clicks':
            updateQuery = 'UPDATE users SET clicks = 0 WHERE deleted = 0 AND login != ?';
            params = ['ILIA'];
            break;
        case 'all':
            updateQuery = 'UPDATE users SET balance = 1000, clicks = 0, total_earned = 0, level = 1, exp = 0 WHERE deleted = 0 AND login != ?';
            params = ['ILIA'];
            break;
        default:
            return res.status(400).json({ error: 'Некорректный тип. Используйте: balance, clicks или all' });
    }

    db.run(updateQuery, params, function (err) {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сброса лидерборда' });
        }

        db.run(`
            INSERT INTO admin_logs (admin_id, action, details) 
            VALUES (?, ?, ?)
        `, [req.userId, 'reset_leaderboard', `Тип: ${type}, Затронуто: ${this.changes} пользователей`], (err) => {
            if (err) console.error('Admin log error:', err);
        });

        res.json({
            success: true,
            type: type,
            affected_users: this.changes,
            message: `Лидерборд ${type} сброшен! Затронуто ${this.changes} пользователей`
        });
    });
});

app.get('/api/admin/logs', adminAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    db.all(`
        SELECT al.*, u.login as admin_login 
        FROM admin_logs al
        JOIN users u ON al.admin_id = u.id
        ORDER BY al.timestamp DESC
        LIMIT ?
    `, [limit], (err, logs) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка получения логов' });
        }

        res.json({
            success: true,
            logs: logs || [],
            total: logs?.length || 0
        });
    });
});

// ====== АВТОМАТИЧЕСКИЕ ПРОЦЕССЫ ======
function accrueDeposits() {
    const now = new Date();
    console.log(`[${now.toLocaleTimeString()}] Проверка вкладов...`);

    db.all('SELECT * FROM deposits', (err, deposits) => {
        if (err) {
            console.error('Ошибка получения вкладов:', err);
            return;
        }

        if (!deposits || deposits.length === 0) {
            console.log('  Нет активных вкладов');
            return;
        }

        const processNext = (index) => {
            if (index >= deposits.length) return;

            const deposit = deposits[index];
            const lastAccrual = new Date(deposit.last_accrual);
            const minutesPassed = Math.floor((now - lastAccrual) / (1000 * 60));

            if (minutesPassed >= 1) {
                const growthRate = 1.001;
                const accrualAmount = Math.floor(deposit.amount * (Math.pow(growthRate, minutesPassed) - 1));

                if (accrualAmount > 0) {
                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');

                        db.run('UPDATE users SET balance = balance + ? WHERE id = ? AND deleted = 0',
                            [accrualAmount, deposit.user_id], (err) => {
                                if (err) {
                                    console.error(`Ошибка обновления баланса для вклада #${deposit.id}:`, err);
                                    db.run('ROLLBACK');
                                    processNext(index + 1);
                                    return;
                                }

                                db.run('UPDATE deposits SET last_accrual = ? WHERE id = ?',
                                    [now.toISOString(), deposit.id], (err) => {
                                        if (err) {
                                            console.error(`Ошибка обновления вклада #${deposit.id}:`, err);
                                            db.run('ROLLBACK');
                                            processNext(index + 1);
                                            return;
                                        }

                                        db.run('INSERT INTO history (user_id, type, amount, details) VALUES (?, "deposit_accrual", ?, ?)',
                                            [deposit.user_id, accrualAmount, `Начисление по вкладу #${deposit.id}`],
                                            (err) => {
                                                if (err) {
                                                    console.error(`Ошибка записи истории для вклада #${deposit.id}:`, err);
                                                }

                                                db.run('COMMIT', (err) => {
                                                    if (err) {
                                                        console.error(`Ошибка коммита для вклада #${deposit.id}:`, err);
                                                    } else {
                                                        console.log(`  Вклад #${deposit.id}: +${accrualAmount}₽`);
                                                    }
                                                    processNext(index + 1);
                                                });
                                            });
                                    });
                            });
                    });
                } else {
                    processNext(index + 1);
                }
            } else {
                processNext(index + 1);
            }
        };

        processNext(0);
    });
}

function cleanupSessions() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000;

    for (const [token, userId] of Object.entries(sessions)) {
        if (activeUsers[userId] && (now - activeUsers[userId].lastActive) > timeout) {
            delete sessions[token];
            delete activeUsers[userId];
            console.log(`Очищена неактивная сессия пользователя ${userId}`);
        }
    }
}

// ====== ЗАПУСК СЕРВЕРА ======
app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
    console.log(`║    🚀 E-BANK 2.0 ULTRA ЗАПУЩЕН!                               ║`);
    console.log(`║    🔗 http://localhost:${PORT}                                     ║`);
    console.log(`║    💎 Кликер + Крипта + Лотерея + Лидерборд                   ║`);
    console.log(`║    🏆 Все функции АКТИВИРОВАНЫ!                              ║`);
    console.log(`║    🔧 Админ-панель доступна: /api/admin/*                    ║`);
    console.log(`║    🔐 Полный список пользователей с паролями                 ║`);
    console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

    setInterval(accrueDeposits, 30000);
    setInterval(cleanupSessions, 300000);
    setTimeout(accrueDeposits, 5000);
});

// Подключаем переменные окружения
require('dotenv').config();

// Импортируем необходимые библиотеки и модули
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Получаем полный путь к файлу базы данных опыта пользователей
const experienceDbPath = path.resolve(process.env.SQLITE_EXPERIENCE_DB_PATH);

// Создаем подключение к базе данных опыта пользователей
const experienceDb = new sqlite3.Database(experienceDbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Подключено к базе данных опыта пользователей.');
    }
});

// Создаем таблицу user_experience, если она ещё не существует
experienceDb.run(`CREATE TABLE IF NOT EXISTS user_experience (
        userId TEXT PRIMARY KEY,
        guildId TEXT NOT NULL,
        experience INTEGER DEFAULT 0
    );`, (err) => {
    if (err) {
        console.error(`Ошибка при создании таблицы user_experience: ${err.message}`);
    }
});

// Функция для добавления опыта пользователю
async function addUserExperience(guildId, userId, experience) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO user_experience (userId, guildId, experience) VALUES (?, ?, ?)
                       ON CONFLICT(userId) DO UPDATE SET experience = experience + ?`;
        experienceDb.run(query, [userId, guildId, experience, experience], function (err) {
            if (err) {
                console.error(`Ошибка при добавлении опыта: ${err.message}`);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}
async function saveUserExperience(userId, guildId, experience) {
    return new Promise((resolve, reject) => {
        experienceDb.run(`INSERT INTO user_experience (userId, guildId, experience) VALUES (?, ?, ?) 
                          ON CONFLICT(userId) DO UPDATE SET experience = experience + ?`,
            [userId, guildId, experience, experience], (err) => {
                if (err) {
                    console.error(`Ошибка при сохранении опыта пользователя: ${err.message}`);
                    reject(err);
                } else {
                    resolve();
                }
            });
    });
}
// Функция для получения опыта пользователя
async function getUserExperience(userId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT experience FROM user_experience WHERE userId = ?`;
        experienceDb.get(query, [userId], (err, row) => {
            if (err) {
                console.error(`Ошибка при получении опыта пользователя: ${err.message}`);
                reject(err);
            } else {
                resolve(row ? row.experience : 0); // Возвращаем 0, если пользователь не найден
            }
        });
    });
}
// Функция для удаления указанного количества опыта пользователя
async function removeUserExperience(userId, guildId, experienceToRemove) {
    return new Promise((resolve, reject) => {
        // SQL-запрос для уменьшения опыта
        const query = `UPDATE user_experience SET experience = experience - ? WHERE userId = ? AND guildId = ?`;
        
        experienceDb.run(query, [experienceToRemove, userId, guildId], function (err) {
            if (err) {
                console.error(`Ошибка при удалении опыта пользователя: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes); // Возвращаем количество изменённых строк
            }
        });
    });
}

// Функция для удаления опыта пользователя
async function removeAllUserExperience(userId) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM user_experience WHERE userId = ?`;
        experienceDb.run(query, [userId], function (err) {
            if (err) {
                console.error(`Ошибка при удалении опыта пользователя: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes); // Возвращаем количество удаленных строк
            }
        });
    });
}

// Функция для очистки опыта всех пользователей в гильдии
async function clearGuildExperience(guildId) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM user_experience WHERE guildId = ?`;
        experienceDb.run(query, [guildId], function (err) {
            if (err) {
                console.error(`Ошибка при очистке опыта в гильдии: ${err.message}`);
                reject(err);
            } else {
                resolve(this.changes); // Возвращаем количество удаленных строк
            }
        });
    });
}
// Функция для получения общего опыта пользователя
async function getUserTotalExperience(userId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT SUM(experience) AS totalExperience FROM user_experience WHERE userId = ?`;
        experienceDb.get(query, [userId], (err, row) => {
            if (err) {
                console.error(`Ошибка при получении общего опыта пользователя: ${err.message}`);
                reject(err);
            } else {
                resolve(row.totalExperience || 0); // Возвращаем общее количество опыта или 0
            }
        });
    });
}

// Функция для получения опыта всех участников сервера
async function getAllUsersExperience(guildId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT userId, experience FROM user_experience WHERE guildId = ?`;
        experienceDb.all(query, [guildId], (err, rows) => {
            if (err) {
                console.error(`Ошибка при получении опыта всех участников: ${err.message}`);
                reject(err);
            } else {
                resolve(rows); // Возвращаем массив объектов с userId и experience
            }
        });
    });
}

// Экспорт функций для работы с опытом пользователей
module.exports = {
    addUserExperience,
    getUserExperience,
    removeUserExperience,
    clearGuildExperience,
    getAllUsersExperience,
    saveUserExperience,
    removeAllUserExperience,
    getUserTotalExperience
};

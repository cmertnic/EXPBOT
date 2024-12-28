// Подключаем необходимые модули
const dotenv = require('dotenv');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Загружаем переменные окружения из файла .env
dotenv.config();

// Проверяем наличие переменной окружения SQLITE_SETTINGS_DB_PATH
if (!process.env.SQLITE_SETTINGS_DB_PATH) {
  console.error('Переменная окружения SQLITE_SETTINGS_DB_PATH не определена.');
  process.exit(1);
}

// Получаем путь к базе данных из переменной окружения
const dbPath = path.resolve(process.env.SQLITE_SETTINGS_DB_PATH);

// Создаем новое подключение к базе данных
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error(`Ошибка при подключении к базе данных: ${err.message}`);
    process.exit(1);
  }
  console.log('Подключено к базе данных настроек');
});

// Создаем таблицу server_settings, если она еще не создана
db.run(`CREATE TABLE IF NOT EXISTS server_settings (
    guildId TEXT PRIMARY KEY,
    logChannelName TEXT,
    language TEXT,
    allowedgivexpRoles TEXT,
    allowedremovexpRoles TEXT,
    allowedvoicexpRoles TEXT,
    allowedinfoxpRoles TEXT
);`, (err) => {
  if (err) {
    console.error(`Ошибка при создании таблицы server_settings: ${err.message}`);
    process.exit(1);
  }
});


// Функция для сохранения настроек сервера в базе данных
function saveServerSettings(guildId, settings) {
  return new Promise((resolve, reject) => {
    const { logChannelName, language, allowedgivexpRoles, allowedremovexpRoles, allowedvoicexpRoles, allowedinfoxpRoles
    } = settings;

    db.run(`REPLACE INTO server_settings
        (guildId, logChannelName, language, allowedgivexpRoles, allowedremovexpRoles, allowedvoicexpRoles, allowedinfoxpRoles)
        VALUES (?, ?, ?, ?, ?, ?,?)`,
      [
        guildId, logChannelName, language, allowedgivexpRoles, allowedremovexpRoles, allowedvoicexpRoles, allowedinfoxpRoles
      ], (err) => {
        if (err) {
          console.error(`Ошибка при сохранении настроек сервера: ${err.message}`);
          reject(err);
        } else {
          resolve();
        }
      });
  });
}

// Функция для получения настроек сервера из базы данных
async function getServerSettings(guildId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM server_settings WHERE guildId = ?`, [guildId], (err, row) => {
      if (err) {
        console.error(`Ошибка при получении настроек сервера: ${err.message}`);
        reject(err);
      } else {
        resolve(row || {});
      }
    });
  });
}

// Функция для инициализации настроек сервера по умолчанию
async function initializeDefaultServerSettings(guildId) {
  try {
    const settings = await getServerSettings(guildId);
    if (!settings.logChannelName) {
      const defaultSettings = {
        guildId: guildId,    
        logChannelName: process.env.LOGCHANNELNAME || 'logs',
        language: process.env.LANGUAGE || 'eng',
        allowedgivexpRoles: process.env.ALLOWEDGIVEXPROLES || 'Admin, Moderator',
        allowedremovexpRoles: process.env.ALLOWEDREMOVEXPROLES || 'Admin, Moderator', 
        allowedvoicexpRoles: process.env.ALLOWEDVOICEXPROLES || 'Admin, Moderator',
        allowedinfoxpRoles: process.env.ALLOWEDINFOXPROLES || 'Admin, Moderator',
      };

      // Сохраняем настройки по умолчанию
      await saveServerSettings(guildId, defaultSettings);
      console.log(`Настройки по умолчанию инициализированы для сервера: ${guildId}`);
    }
  } catch (err) {
    console.error(`Ошибка при инициализации настроек сервера: ${err.message}`);
    throw err;
  }
}

// Экспортируем функции для использования в других модулях
module.exports = {
  saveServerSettings,
  initializeDefaultServerSettings,
  getServerSettings
};

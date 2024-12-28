// Подключаем необходимые библиотеки
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const { getServerSettings } = require('./database/settingsDb');

    /**
     * Выполнение команды
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с пользователем
     */
async function initializeI18next(currentLanguage) {
  await i18next
    .use(Backend)
    .init({
      lng: currentLanguage, // Устанавливаем текущий язык
      fallbackLng: 'eng', // Язык по умолчанию, если текущий не найден
      backend: {
        loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json'), // Путь к файлам локализации
      },
      initImmediate: false, // Откладываем инициализацию, чтобы можно было изменить язык до фактической инициализации
    });
}
async function updateI18nextLanguage(guildId) {
  try {
    // Получаем настройки сервера
    const serverSettings = await getServerSettings(guildId);
    const language = serverSettings.language; // Получаем язык из настроек сервера

    // Изменяем язык i18next
    await i18next.changeLanguage(language);
  } catch (error) {
    console.error('Ошибка при обновлении языка:', error); // Логируем ошибку, если она произойдет
  }
}

// Экспортируем i18next, функцию перевода t, а также функции инициализации и обновления языка
module.exports = {
  i18next,
  t: (key, options) => i18next.t(key, options), // Функция перевода текста с помощью i18next
  initializeI18next,
  updateI18nextLanguage,
};
// Загружаем переменные окружения
require('dotenv').config();

// Импортируем необходимые модули
const { Client, GatewayIntentBits, Partials, Collection, ChannelType, REST, Routes, EmbedBuilder, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, Events } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
const { getAllUsersExperience } = require('./database/experienceDb');
const { initializeDefaultServerSettings, getServerSettings } = require('./database/settingsDb');
const { initializeI18next, i18next, t } = require('./i18n');
const { createLogChannel, getOrCreateVoiceChannel, createVoiceLogChannel, createRoles, ensureRolesExist,assignNewMemberRole } = require('./events');


// Инициализируем переменные
const commands = [];
const guildsData = new Map();
const rest = new REST().setToken(process.env.TOKEN);

// Загружаем и регистрируем команды
(async () => {
  await initializeI18next('eng');
  try {
    // Создаем экземпляр клиента Discord
    const { Client, GatewayIntentBits, Partials } = require('discord.js');

    const robot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildScheduledEvents
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
        Partials.GuildScheduledEvent
      ]
    });

    robot.commands = new Collection();
    const commandFolders = fs.readdirSync('./commands');

    for (const folder of commandFolders) {
      const commandFiles = fs.readdirSync(`./commands/${folder}`).filter((file) => file.endsWith('.js'));
      for (const file of commandFiles) {
        const command = require(`./commands/${folder}/${file}`);
        if ('data' in command && 'execute' in command) {
          robot.commands.set(command.data.name, command);
          commands.push(command.data.toJSON());
        } else {
          console.log(`Предупреждение! Команда по пути ./commands/${folder}/${file} потеряла свойство "data" или "execute".`);
        }
      }
    }
    // Инициализируем локализацию для сервера
    async function initializeLocalizationForServer(guildId) {
      try {
        const serverSettings = await getServerSettings(guildId);
        const serverLanguage = serverSettings.language;
        await initializeI18next(serverLanguage);
      } catch (error) {
        console.error('Ошибка при инициализации локализации:', error);
      }
    }
    // Регистрируем команды
    try {
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );

      console.log(`Успешно зарегистрировано ${data.length} команд.`);
    } catch (error) {
      console.error('Ошибка при регистрации команд:', error);
    }

    // Обработчики событий
    robot.on('guildCreate', async (guild) => {
      console.log(`Бот добавлен на сервер: ${guild.name}`);

      // Инициализируем настройки сервера по умолчанию
      await initializeDefaultServerSettings(guild.id);

      // Устанавливаем небольшую задержку перед обновлением данных гильдии
      await new Promise((resolve) => setTimeout(resolve, 500));

      const defaultSettings = await getServerSettings(guild.id);
      // Сохраняем данные гильдии в Map
      guildsData.set(guild.id, defaultSettings);
      console.log(`Данные гильдии инициализированы для ID: ${guild.id}`);
    });

    robot.on('ready', async () => {
      console.log(`${robot.user.username} готов вкалывать`);
      const guilds = robot.guilds.cache;

      for (const guild of guilds.values()) {
        const guildId = guild.id;

        try {
          let serverSettings = await getServerSettings(guildId);

          if (!serverSettings || Object.keys(serverSettings).length === 0) {
            await initializeDefaultServerSettings(guildId);
            serverSettings = await getServerSettings(guildId);
          }

          await initializeLocalizationForServer(guildId);

          guildsData.set(guildId, serverSettings);

        } catch (error) {
          console.error(`Ошибка при обработке сервера ${guildId}:`, error);
        }
      }

      try {
        await rest.put(
          Routes.applicationCommands(robot.user.id),
          { body: commands },
        );

      } catch (error) {
        console.error('Ошибка при регистрации команд:', error);
      }
    });
    robot.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const command = robot.commands.get(interaction.commandName);

      if (!command) {
        await interaction.reply({ content: 'Команда не найдена!', ephemeral: true });
        return;
      }

      try {
        let serverLanguage = 'eng';

        if (interaction.guild) {
          // Получаем настройки сервера для языка
          const guildId = interaction.guild.id;
          const serverSettings = await getServerSettings(guildId);
          serverLanguage = serverSettings.language || 'rus';
        }

        // Обновляем язык для команды
        await initializeI18next(serverLanguage);

        console.log(`Выполнение команды: ${interaction.commandName} от пользователя: ${interaction.user.tag} (ID: ${interaction.user.id})`);
        await command.execute(robot, interaction);
      } catch (error) {
        console.error(`Ошибка при выполнении команды от пользователя: ${interaction.user.tag} (ID: ${interaction.user.id}):`, error);
        await interaction.reply({ content: 'Произошла ошибка при выполнении команды!', ephemeral: true });
      }

    });

    function setupCronJobs(robot) {
      cron.schedule('*/2 * * * *', async () => {
        console.log('Запуск задачи по расписанию для проверки');

        try {
          // Проверяем, инициализирован ли объект robot и доступны ли guilds
          if (!robot || !robot.guilds) {
            console.log('Объект robot не инициализирован или guilds недоступны.');
            return;
          }

          // Проверяем, есть ли доступные гильдии
          if (robot.guilds.cache.size === 0) {
            console.log('Нет доступных серверов для обработки.');
            return;
          }

          for (const guild of robot.guilds.cache.values()) {


            try {

              // Получаем настройки сервера
              const serverSettings = await getServerSettings(guild.id);

            } catch (error) {
              console.error(`Ошибка при обработке сервера ${guild.id}:`, error);
            }
          }
        } catch (error) {
          console.error(`Ошибка при запуске задачи cron:`, error);
        }
      });
    }


    setupCronJobs(robot);

    robot.login(process.env.TOKEN);
  } catch (error) {
    console.error('Ошибка при инициализации бота:', error);
  }
})();    
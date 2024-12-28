// Импорт необходимых модулей и функций
const { SlashCommandBuilder, Client, ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { saveUserExperience } = require('../../database/experienceDb'); // Импортируем функцию для сохранения опыта
const { i18next } = require('../../i18n');
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');

// Константы для опций команды
const USER_OPTION_NAME = 'user';
const EXPERIENCE_OPTION_NAME = 'experience';
const REASON_OPTION_NAME = 'reason'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('givexp')
        .setDescription('Выдать опыт пользователю')
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription('ID или упоминание пользователя')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName(EXPERIENCE_OPTION_NAME)
                .setDescription('Количество опыта для выдачи (должно быть положительным числом)')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option => 
            option.setName(REASON_OPTION_NAME)
                .setDescription('Причина выдачи опыта')
                .setRequired(true)
        ),

    /**
     * Выполнение команды
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с пользователем
     */
    async execute(robot, interaction) {
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });

        try {
            // Проверяем, что команда не вызвана ботом
            if (interaction.user.bot) return;

            if (interaction.channel.type === ChannelType.DM) {
                return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
            }

            const serverSettings = await getServerSettings(interaction.guild.id);
            const {allowedgivexpRoles, logChannelName } = serverSettings;

            // Извлекаем названия разрешенных ролей
            const allowedRolesArray = allowedgivexpRoles.split(',').map(role => role.trim());

            // Проверяем наличие роли у пользователя
            const hasAllowedRole = interaction.member.roles.cache.some(role => allowedRolesArray.includes(role.name));
            
            // Проверяем права доступа
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasAllowedRole) {
                return await interaction.editReply({ content: 'У вас нет прав на выполнение этой команды.', ephemeral: true });
            }

            // Получаем пользователя и количество опыта
            const user = interaction.options.getUser (USER_OPTION_NAME);
            const experienceToAdd = interaction.options.getInteger(EXPERIENCE_OPTION_NAME);
            const reason = interaction.options.getString(REASON_OPTION_NAME); // Получаем причину

            // Сохраняем опыт пользователю в базе данных
            await saveUserExperience(user.id, interaction.guild.id, experienceToAdd);

            // Отправляем сообщение о завершении выполнения команды
            await interaction.editReply({ content: i18next.t('experience.give_success', { userId: user.id, experience: experienceToAdd, reason }), ephemeral: true });

            // Оповещение пользователя о получении опыта
            try {
                await user.send(i18next.t('experience.received', { experience: experienceToAdd, giver: interaction.user.id, reason }));
            } catch (error) {
                console.error(`Не удалось отправить сообщение пользователю: ${error.message}`);
            }

            // Логирование действия
            let logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

            // Проверка и создание лог-канала, если он не найден
            if (!logChannel) {
                const channelNameToCreate = logChannelName;
                const roles = interaction.guild.roles.cache;
                const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                // Выход из функции, если произошла ошибка при создании канала
                if (logChannelCreationResult.startsWith('Ошибка')) {
                    return interaction.editReply({ content: logChannelCreationResult, ephemeral: true });
                }

                // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            // Создаем embed для логирования
            const embedLog = new EmbedBuilder()
                .setColor(0x00FF00) // Цвет embed
                .setTitle(i18next.t('experience.give_log_title')) // Заголовок
                .setDescription(i18next.t('experience.give_log_description', { userId: user.id, experience: experienceToAdd, giver: interaction.user.id, reason })) // Описание
                .setTimestamp() // Время
                .setFooter({ text: i18next.t('experience.give_log_footer', { moderator: interaction.user.tag }) }); // Подпись внизу

            // Отправляем embed в лог-канал
            await logChannel.send({ embeds: [embedLog] });

            // Логируем в чат, где была вызвана команда
            await interaction.followUp({ embeds: [embedLog] });

        } catch (error) {
            console.error(`Произошла ошибка при выполнении команды giveExperience: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};

// Импорт необходимых модулей и функций
const { SlashCommandBuilder, Client, ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { saveUserExperience } = require('../../database/experienceDb'); // Импортируем функцию для сохранения опыта
const { i18next } = require('../../i18n');
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const EXPERIENCE_OPTION_NAME = 'experience';
const REASON_OPTION_NAME = 'reason';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicexp')
        .setDescription('Выдать опыт всем участникам голосового канала')
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
        await interaction.deferReply();

        try {
            // Проверяем, что команда не вызвана ботом
            if (interaction.user.bot) return;

            const serverSettings = await getServerSettings(interaction.guild.id);
            const {allowedvoicexpRoles, logChannelName} = serverSettings;

            // Извлекаем названия разрешенных ролей
            const allowedRolesArray = allowedvoicexpRoles.split(',').map(role => role.trim());

            // Проверяем наличие роли у пользователя
            const hasAllowedRole = interaction.member.roles.cache.some(role => allowedRolesArray.includes(role.name));
            
            // Проверяем права доступа
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasAllowedRole) {
                return await interaction.editReply({ content: 'У вас нет прав на выполнение этой команды.', ephemeral: true });
            }

            // Получаем количество опыта и причину
            const experienceToAdd = interaction.options.getInteger(EXPERIENCE_OPTION_NAME);
            const reason = interaction.options.getString(REASON_OPTION_NAME);

            // Получаем голосовой канал, в котором находится пользователь, вызвавший команду
            const voiceChannel = interaction.member.voice.channel;

            if (!voiceChannel) {
                return await interaction.editReply({ content: i18next.t('error_not_in_voice_channel'), ephemeral: true });
            }

            // Получаем участников голосового канала
            const membersInVoice = voiceChannel.members;

            // Проверяем, есть ли участники в голосовом канале
            if (membersInVoice.size === 0) {
                return await interaction.editReply({ content: i18next.t('error_no_members_in_voice'), ephemeral: true });
            }

            // Перебираем участников и выдаем им опыт
            for (const [memberId, member] of membersInVoice) {
                // Сохраняем опыт пользователю в базе данных
                await saveUserExperience(member.id, interaction.guild.id, experienceToAdd);
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

            // Логирование действия (не эфемерное)
            const embedLog = new EmbedBuilder()
                .setColor(0x00FF00) // Цвет embed
                .setTitle(i18next.t('experience.give_log_title_voice')) // Заголовок
                .setDescription(i18next.t('experience.give_log_description_voice', { 
                    experience: experienceToAdd, 
                    giver: interaction.user.id, 
                    reason, 
                    voiceChannel: voiceChannel.name // Упоминание голосового канала
                })) // Описание
                .setTimestamp(); // Время

            // Отправляем лог в канал, где была вызвана команда (не эфемерное)
            await interaction.followUp({ embeds: [embedLog] });
            // Отправляем embed в лог-канал
            await logChannel.send({ embeds: [embedLog] });
        } catch (error) {
            console.error(`Произошла ошибка при выполнении команды voicexp: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};

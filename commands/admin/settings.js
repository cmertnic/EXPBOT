// Импорт необходимых модулей и функций
const { ChannelType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { initializeDefaultServerSettings, getServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');
const { handleButtonInteraction, displaySettings } = require('../../events');
const userCommandCooldowns = new Map();

// Экспортируем объект команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Настройки сервера'),
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
        }

        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'settings' && Date.now() < commandCooldown.endsAt) {
            const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
            return interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft })), ephemeral: true });
        }

        const guildId = interaction.guild.id;

        // Проверка прав администратора у пользователя, вызвавшего команду
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            interaction.reply({ content: i18next.t('Admin_user_check'), ephemeral: true });
            return;
        }

        userCommandCooldowns.set(interaction.user.id, { command: 'settings', endsAt: Date.now() + 300200 });

        try {
            // Получение настроек сервера или создание настроек по умолчанию, если их нет
            const config = await getServerSettings(guildId) || await initializeDefaultServerSettings(guildId);
            // Отправка уведомления о загрузке настроек
            await interaction.reply({ content: (i18next.t('settings.load')), ephemeral: true });
            // Отображение настроек
            await displaySettings(interaction, config);

            // Создание коллектора сообщений для обработки кнопок
            const filter = (i) => i.user.id === interaction.user.id && !i.customId.startsWith('language_'); // Игнорируем customId, начинающийся с  language_
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

            // Обработка нажатых кнопок
            collector.on('collect', async (i) => {
                if (i.deferred || i.replied) return;
                const page = parseInt(i.message.embeds[0]?.footer?.text?.match(/\d+/)?.[0]) || 1;
                await handleButtonInteraction(i, config, page);
                await i.editReply({ content: (i18next.t('settings.load')), ephemeral: true });
            });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }

        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
        }, 300200);
    }
};

const { SlashCommandBuilder, Client, ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { getUserTotalExperience } = require('../../database/experienceDb'); // Импортируем функцию для получения опыта
const { i18next } = require('../../i18n');
const { getServerSettings } = require('../../database/settingsDb');
const USER_OPTION_NAME = 'user';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('infoxp')
        .setDescription('Показать опыт пользователя')
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription('ID или упоминание пользователя')
                .setRequired(false) // Делаем необязательным
        ),

    async execute(robot, interaction) {
        await interaction.deferReply();

        try {
            // Проверяем, что команда не вызвана ботом
            if (interaction.user.bot) return;

            if (interaction.channel.type === ChannelType.DM) {
                return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
            }

            const serverSettings = await getServerSettings(interaction.guild.id);
            const {allowedinfoxpRoles} = serverSettings;

            // Извлекаем названия разрешенных ролей
            const allowedRolesArray = allowedinfoxpRoles.split(',').map(role => role.trim());

            // Проверяем наличие роли у пользователя
            const hasAllowedRole = interaction.member.roles.cache.some(role => allowedRolesArray.includes(role.name));
            
            // Проверяем права доступа
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasAllowedRole) {
                return await interaction.editReply({ content: 'У вас нет прав на выполнение этой команды.', ephemeral: true });
            }

            // Получаем пользователя (если не указан, используем автора команды)
            const user = interaction.options.getUser (USER_OPTION_NAME) || interaction.user;

            // Получаем общее количество опыта у пользователя
            const totalExperience = await getUserTotalExperience(user.id);

            // Проверяем, есть ли опыт
            if (totalExperience === 0) {
                return await interaction.editReply({ content: i18next.t('experience.not_found', { userId: user.id }), ephemeral: true });
            }

            // Создаем embed для отображения опыта
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Цвет embed
                .setTitle(i18next.t('experience.show_title', { userId: user.id }))
                .setDescription(i18next.t('experience.show_description', { userId: user.id, experience: totalExperience }))
                .setThumbnail(user.displayAvatarURL()) // Картинка пользователя
                .setTimestamp();

                
            // Отправляем embed с информацией об опыте
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Произошла ошибка при выполнении команды infoxp: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};

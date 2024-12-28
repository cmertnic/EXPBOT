const { SlashCommandBuilder, Client, ChannelType, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();
const { removeUserExperience, removeAllUserExperience, getUserTotalExperience } = require('../../database/experienceDb'); // Импортируем функции для удаления опыта
const { i18next } = require('../../i18n');
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removexp')
        .setDescription(i18next.t('убрать опыт у пользователя')) // Локализация описания команды
        .addUserOption(option =>
            option.setName('user')
                .setDescription(i18next.t('Пользователь')) // Локализация описания пользователя
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription(i18next.t('Причина')) // Локализация описания причины
                .setRequired(true)
        ),

    async execute(robot, interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            if (interaction.user.bot) return;

            if (interaction.channel.type === ChannelType.DM) {
                return await interaction.reply({ content: i18next.t('error.private_messages'), ephemeral: true });
            }

            const serverSettings = await getServerSettings(interaction.guild.id);
            const {allowedremovexpRoles} = serverSettings;

            // Извлекаем названия разрешенных ролей
            const allowedRolesArray = allowedremovexpRoles.split(',').map(role => role.trim());

            // Проверяем наличие роли у пользователя
            const hasAllowedRole = interaction.member.roles.cache.some(role => allowedRolesArray.includes(role.name));
            
            // Проверяем права доступа
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasAllowedRole) {
                return await interaction.editReply({ content: 'У вас нет прав на выполнение этой команды.', ephemeral: true });
            }

            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            // Получаем общее количество опыта у пользователя
            const totalExperience = await getUserTotalExperience(user.id);
            if (totalExperience === 0) {
                return await interaction.followUp({ content: i18next.t('experience.not_found', { userId: user.id }), ephemeral: true });
            }

            // Создаем Embed с кнопками
            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle(i18next.t('experience.remove_title'))
                .setDescription(i18next.t('experience.remove_description', { userId: user.id, reason }));

            const removeAmountButton = new ButtonBuilder()
                .setCustomId('remove_amount')
                .setLabel(i18next.t('experience.remove_amount_button')) // Локализация кнопки удаления определенного количества опыта
                .setStyle(ButtonStyle.Primary);

            const removeAllButton = new ButtonBuilder()
                .setCustomId('remove_all')
                .setLabel(i18next.t('experience.remove_all_button')) // Локализация кнопки удаления всего опыта
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(removeAmountButton, removeAllButton);

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

            // Фильтруем взаимодействия
            const filter = i => i.user.id === interaction.user.id;

            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });

            collector.on('collect', async i => {
                await i.deferUpdate(); // Подтверждаем взаимодействие

                if (i.customId === 'remove_amount') {
                    await interaction.followUp({ content: i18next.t('experience.enter_number'), ephemeral: true });

                    const numberFilter = response => {
                        const amount = parseInt(response.content);
                        return !isNaN(amount) && amount > 0; // Проверка, что введено положительное число
                    };

                    try {
                        const collected = await interaction.channel.awaitMessages({ filter: numberFilter, max: 1, time: 30000, errors: ['time'] });
                        const amountMessage = collected.first();
                        const amount = parseInt(amountMessage.content);

                        // Удаляем сообщение пользователя
                        await amountMessage.delete();

                        const changes = await removeUserExperience(user.id, interaction.guild.id, amount);
                        if (changes === 0) {
                            return await interaction.followUp({ content: i18next.t('experience.not_found', { userId: user.id }), ephemeral: true });
                        }
                        await interaction.followUp({ content: i18next.t('experience.remove_success', { userId: user.id, experience: amount, reason }), ephemeral: true });

                        // Уведомление пользователя
                        await user.send(i18next.t('experience.removed', { experience: amount, remover: interaction.user.id, reason }));

                        // Логирование действия
                        const serverSettings = await getServerSettings(interaction.guild.id);
                        const logChannelName = serverSettings.logChannelName;
                        let logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
                        const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

                        if (!logChannel) {
                            const channelNameToCreate = logChannelName;
                            const roles = interaction.guild.roles.cache;
                            const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                            const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                            if (logChannelCreationResult.startsWith('Ошибка')) {
                                return interaction.followUp({ content: logChannelCreationResult, ephemeral: true });
                            }

                            logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
                        }

                        const embedLog = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(i18next.t('experience.remove_log_title'))
                            .setDescription(i18next.t('experience.remove_log_description', { userId: user.id, experience: amount, remover: interaction.user.id, reason }))
                            .setTimestamp()
                            .setFooter({ text: i18next.t('experience.remove_log_footer', { moderator: interaction.user.tag }) });

                        await logChannel.send({ embeds: [embedLog] });
                        await interaction.channel.send({ embeds: [embedLog] });
                    } catch (error) {
                        await interaction.followUp({ content: i18next.t('error.timeout'), ephemeral: true });
                    }
                } else if (i.customId === 'remove_all') {
                    // Удаляем весь опыт у пользователя
                    await removeAllUserExperience(user.id);
                    await interaction.followUp({ content: i18next.t('experience.remove_success', { userId: user.id, experience: totalExperience, reason }), ephemeral: true });

                    // Уведомление пользователя
                    await user.send(i18next.t('experience.removed', { experience: totalExperience, remover: interaction.user.id, reason }));

                    // Логирование действия
                    const serverSettings = await getServerSettings(interaction.guild.id);
                    const logChannelName = serverSettings.logChannelName;
                    let logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
                    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

                    if (!logChannel) {
                        const channelNameToCreate = logChannelName;
                        const roles = interaction.guild.roles.cache;
                        const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                        const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                        if (logChannelCreationResult.startsWith('Ошибка')) {
                            return interaction.followUp({ content: logChannelCreationResult, ephemeral: true });
                        }

                        logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
                    }

                    const embedLog = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle(i18next.t('experience.remove_log_title'))
                        .setDescription(i18next.t('experience.remove_log_description', { userId: user.id, experience: totalExperience, remover: interaction.user.id, reason }))
                        .setTimestamp()
                        .setFooter({ text: i18next.t('experience.remove_log_footer', { moderator: interaction.user.tag }) });

                    await logChannel.send({ embeds: [embedLog] });
                    await interaction.channel.send({ embeds: [embedLog] });
                }
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.followUp({ content: i18next.t('error.timeout'), ephemeral: true });
                }
            });

        } catch (error) {
            console.error(`Произошла ошибка при выполнении команды removexp: ${error.message}`);
            return interaction.editReply({ content: i18next.t('error.generic'), ephemeral: true });
        }
    }
};

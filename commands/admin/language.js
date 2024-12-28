// Импорт необходимых модулей и функций
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { saveServerSettings, getServerSettings } = require('../../database/settingsDb');
const validLanguages = ['eng', 'rus'];
const { i18next, t, updateI18nextLanguage } = require('../../i18n');
const userCommandCooldowns = new Map();

// Экспортируем объект команды
module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('язык сервера'),

  async execute(robot, interaction) {
    if (interaction.user.bot) return;
    if (interaction.channel.type === ChannelType.DM) {
      return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
    }

    const commandCooldown = userCommandCooldowns.get(interaction.user.id);
    if (commandCooldown && commandCooldown.command === 'language' && Date.now() < commandCooldown.endsAt) {
      const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
      return await interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft })), ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({ content: i18next.t('Admin_user_check'), ephemeral: true });
    }

    const config = await getServerSettings(interaction.guildId) || { language: 'eng' };

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`language_select_${interaction.user.id}`)
      .setPlaceholder(i18next.t('language.select_language'));

    validLanguages.forEach((lang) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(i18next.t(`language.language_${lang}`))
        .setValue(lang);

      if (lang === config.language) {
        option.setDefault(true);
      }

      selectMenu.addOptions(option);
    });

    const selectMenuRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      components: [selectMenuRow],
      ephemeral: true,
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('language_select_'),
      time: 30000,
    });

    userCommandCooldowns.set(interaction.user.id, { command: 'language', endsAt: Date.now() + 300200 });

    collector.on('collect', async (i) => {
      const newLanguage = i.values?.[0] || 'eng';
      config.language = newLanguage;
      await saveServerSettings(interaction.guildId, config);
      updateI18nextLanguage(interaction.guildId, newLanguage);

      try {
        await i.update({
          content: i18next.t('language.language_updated', { newLanguage }),
          components: [],
        });
      } catch (error) {
        console.error('Error updating interaction:', error);
      }

      collector.stop();
    });

    collector.on('end', () => {
      userCommandCooldowns.delete(interaction.user.id);
    });
  },
};

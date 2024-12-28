const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const { saveServerSettings, getServerSettings } = require('./database/settingsDb');
const { i18next, t, updateI18nextLanguage } = require('./i18n');
const sharp = require('sharp');
const axios = require('axios');
// Функция для валидации ID пользователя с помощью регулярного выражения
function validateUserId(userId) {
    const regex = /^(?:<@)?!?(\d{17,19})>?$/;
    const match = userId.match(regex);
    return match ? match[1] : null;
}

// Функция для обеспечения существования директории
async function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    try {
        await fs.access(dirname);
    } catch (err) {
        await fs.mkdir(dirname, { recursive: true });
    }
}

// Функция для форматирования продолжительности в дни, часы, минуты и секунды
function formatDuration(duration) {
    const days = Math.floor(duration / (1000 * 60 * 60 * 24));
    const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    const seconds = Math.floor((duration / 1000) % 60);

    const parts = [];
    if (days > 0) parts.push(`${days} ${t('formatDuration_d' + getPlural(days, '1', '2', '3'))}`);
    if (hours > 0) parts.push(`${hours} ${t('formatDuration_h' + getPlural(hours, '1', '2', '3'))}`);
    if (minutes > 0) parts.push(`${minutes} ${t('formatDuration_m' + getPlural(minutes, '1', '2', '3'))}`);
    if (seconds > 0) parts.push(`${seconds} ${t('formatDuration_s' + getPlural(seconds, '1', '2', '3'))}`);

    return parts.join(' ');
}


// Функция для выдачи роли "Новичок"
async function assignNewMemberRole(member, newMemberRoleName) {
    let role = member.guild.roles.cache.find(r => r.name === newMemberRoleName);

    if (role) {
        // Выдаем роль пользователю
        await member.roles.add(role);
    } else {
        // Если роль не найдена, создаем ее
        const roleCreationMessages = await ensureRolesExist(member.guild, newMemberRoleName);
        if (roleCreationMessages) {
            console.log(roleCreationMessages);
            // После создания роли снова получаем её и выдаем пользователю
            role = member.guild.roles.cache.find(r => r.name === newMemberRoleName);
            if (role) {
                await member.roles.add(role);
            }
        }
    }
}
// Функция для преобразования пользовательского формата времени в миллисекунды
function convertToTimestamp(customTimeFormat) {
    const defaultValues = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
    const parts = customTimeFormat.split(':').map(part => parseInt(part, 10));

    const timeParts = { ...defaultValues };
    parts.forEach((part, index) => {
        if (part) {
            const key = Object.keys(defaultValues)[index];
            timeParts[key] = part;
        }
    });

    const timeInMilliseconds = (timeParts.days * 86400000) +
        (timeParts.hours * 3600000) +
        (timeParts.minutes * 60000) +
        (timeParts.seconds * 1000) +
        timeParts.milliseconds;

    return timeInMilliseconds;
}

// Функция для преобразования строки времени в миллисекунды
function convertToMilliseconds(timeString) {
    const timePattern = /(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s\s*)?/;
    const match = timePattern.exec(timeString);

    if (!match) return 300000;

    const days = parseInt(match[1]) || 0;
    const hours = parseInt(match[2]) || 0;
    const minutes = parseInt(match[3]) || 0;
    const seconds = parseInt(match[4]) || 0;

    const millisecondsPerDay = 86400000;
    const millisecondsPerHour = 3600000;
    const millisecondsPerMinute = 60000;
    const millisecondsPerSecond = 1000;

    return days * millisecondsPerDay +
        hours * millisecondsPerHour +
        minutes * millisecondsPerMinute +
        seconds * millisecondsPerSecond;
}

// Дополнительные функции для обработки сообщений
async function sendPart(channel, part) {
    await channel.send(part).catch(e => console.error(e));
}

async function sendLongMessage(channel, text) {
    const MAX_LENGTH = 2000;

    if (text.length <= MAX_LENGTH) {
        await sendPart(channel, text);
    } else {
        const parts = text.match(/(.|[\r\n]){1,1980}(?=\s|$)|(.|[\r\n])+?(\s|$)/g);
        for (const part of parts) {
            if (part.length > 0) {
                const partText = part + '...(продолжение)';
                await sendPart(channel, partText);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }
}

// Функция для удаления сообщений от забаненных пользователей
async function deleteMessages(user, deleteMessagesTime, guild, logChannel) {
    let deletedMessagesCount = 0;
    const DELETE_MESSAGES_TIME_VALUES = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '3d': 72 * 60 * 60 * 1000,
        '7d': 168 * 60 * 60 * 1000,
    };

    const textChannels = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText);
    const promises = textChannels.map(async channel => {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesFromBannedUser = messages.filter(m => m.author.id === user.id);

            if (messagesFromBannedUser.size > 0) {
                let messagesBatch;
                const now = Date.now();
                const deleteMessagesDurationMs = convertToMilliseconds(DELETE_MESSAGES_TIME_VALUES[deleteMessagesTime]);

                switch (deleteMessagesTime) {
                    case '1h':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['1h']);
                        break;
                    case '6h':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['6h']);
                        break;
                    case '12h':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['12h']);
                        break;
                    case '1d':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['1d']);
                        break;
                    case '3d':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['3d']);
                        break;
                    case '7d':
                        messagesBatch = messagesFromBannedUser.filter(m => now - m.createdTimestamp < DELETE_MESSAGES_TIME_VALUES['7d']);
                        break;
                    default:
                        messagesBatch = messagesFromBannedUser;
                        break;
                }

                if (messagesBatch.size > 0) {
                    deletedMessagesCount += messagesBatch.size;
                    await channel.bulkDelete(messagesBatch);
                }
            }
        } catch (error) {
            console.error(`Ошибка при удалении сообщений из канала ${channel.name}:`, error);
        }
    });
    await Promise.all(promises);
    return deletedMessagesCount;
}

// Функция для определения правильной формы слова в зависимости от числа
function getPlural(n, singular, few, many) {
    if (n % 10 === 1 && n % 100 !== 11) {
        return singular;
    } else if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) {
        return few;
    } else {
        return many;
    }
}

// Функция для отправления сообщения и его удаления
async function sendPartAndDelete(context, part) {
    try {
        let message;
        if (context.channel) {
            // Если context имеет канал, отправляем сообщение в этот канал
            message = await context.channel.send(part);
        } else if (context.reply) {
            // Если context имеет метод reply, используем его для отправки сообщения
            message = await context.reply(part);
        }

        // Удаление сообщения после заданного времени
        setTimeout(() => {
            if (message.delete) {
                message.delete();
            }
        }, 10000); // Удаляет сообщение через 10 секунд
    } catch (error) {
        console.error('Ошибка при отправке или удалении сообщения:', error);
    }
}

// Функция для создания главного канала лоигрования
async function createMainLogChannel(interaction, channelName, botMember, higherRoles, serverSettings) {
    const result = await getOrCreateLogChannel(interaction.guild, channelName, botMember, higherRoles);
    if (result) {
        if (result.created) {
            serverSettings.logChannelName = result.channel.name;
            await saveServerSettings(interaction.guild.id, serverSettings);
            return i18next.t('mainLogChannel_create', { channelName: result.channel.name });
        } else {
            return i18next.t('mainLogChannel_exists', { channelName: result.channel.name });
        }
    } else {
        return i18next.t('mainLogChannel_error');
    }
}

// Функция получения или создания текстового канала
async function getOrCreateLogChannel(guild, channelName, botMember, higherRoles) {
    const message = i18next.t('logChannel_reason');
    let fetchedChannels = await guild.channels.fetch();
    const existingChannel = fetchedChannels.find(c => c.name === channelName && c.type === ChannelType.GuildText);

    if (existingChannel) {
        return { channel: existingChannel, created: false };
    } else {
        const everyoneRole = guild.roles.everyone;
        const moderators = await guild.members.fetch().then(members => members.filter(member => member.permissions.has(PermissionFlagsBits.ModerateMembers)));

        try {
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: everyoneRole.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: botMember.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    },
                    ...moderators.map(member => ({
                        id: member.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    })),
                    ...higherRoles.map(role => ({
                        id: role.id,
                        allow: [PermissionFlagsBits.ViewChannel]
                    }))
                ],
                reason: message
            });

            return { channel, created: true };
        } catch (error) {
            console.error(`Ошибка при создании канала: ${error}`);
            return null; // Возвращаем null в случае ошибки
        }
    }
}

// Функция получения или создания голосового канала
async function getOrCreateVoiceChannel(guild, channelName, botMember) {
    const fetchedChannels = await guild.channels.fetch();
    const existingChannel = fetchedChannels.find(c => c.name === channelName && c.type === ChannelType.GuildVoice);

    if (existingChannel) {
        return { channel: existingChannel, created: false };
    } else {
        const everyoneRole = guild.roles.everyone;

        try {
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                permissionOverwrites: [
                    {
                        id: everyoneRole.id,
                        allow: [PermissionFlagsBits.Connect]
                    },
                    {
                        id: botMember.id,
                        allow: [PermissionFlagsBits.Connect]
                    }
                ],
                reason: i18next.t('logChannel_reason')
            });

            return { channel, created: true };
        } catch (error) {
            console.error(`Ошибка при создании канала: ${error}`);
            return null; // Возвращаем null в случае ошибки
        }
    }
}


// Функция для создания побочных каналов логирования
async function createLogChannel(interaction, channelName, botMember, higherRoles) {
    const result = await getOrCreateLogChannel(interaction.guild, channelName, botMember, higherRoles);
    if (result) {
        if (result.created) {
            return i18next.t('logChannel_create', { channelName: channelName, createdChannelName: result.channel.name });
        } else {
            return i18next.t('logChannel_exists', { channelName: channelName, createdChannelName: result.channel.name });
        }
    } else {
        return i18next.t('logChannel_error', { channelName: channelName });
    }
}
// Функция для создания побочных голосовых каналов логирования
async function createVoiceLogChannel(interaction, channelName, botMember, higherRoles) {
    const result = await getOrCreateVoiceLogChannel(interaction.guild, channelName, botMember, higherRoles);
    if (result) {
        if (result.created) {
            return i18next.t('logChannel_create', { channelName: channelName, createdChannelName: result.channel.name });
        } else {
            return i18next.t('logChannel_exists', { channelName: channelName, createdChannelName: result.channel.name });
        }
    } else {
        return i18next.t('logChannel_error', { channelName: channelName });
    }
}

// Функция для создания голосового канала логирования
async function createVoiceLogChannel(interaction, channelName, botMember, higherRoles) {
    const result = await getOrCreateVoiceLogChannel(interaction.guild, channelName, botMember, higherRoles);
    if (result) {
        if (result.created) {
            return i18next.t('logChannel_create', { channelName: channelName, createdChannelName: result.channel.name });
        } else {
            return i18next.t('logChannel_exists', { channelName: channelName, createdChannelName: result.channel.name });
        }
    } else {
        return i18next.t('logChannel_error', { channelName: channelName });
    }
}

// Функция для получения или создания голосового канала логирования
async function getOrCreateVoiceLogChannel(guild, channelName, botMember, higherRoles) {
    // Проверяем, существует ли канал с таким именем
    const existingChannel = guild.channels.cache.find(channel => channel.name === channelName && channel.type === ChannelType.GuildVoice);
    if (existingChannel) {
        return { created: false, channel: existingChannel };
    }

    // Генерируем случайное имя, если канал не найден
    const randomSuffix = Math.floor(Math.random() * 1000); // Генерируем случайное число от 0 до 999
    const newChannelName = `${channelName}-${randomSuffix}`; // Создаем новое имя канала

    // Создаем новый голосовой канал
    try {
        const newChannel = await guild.channels.create(newChannelName, {
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    allow: ['VIEW_CHANNEL'],
                    deny: ['SEND_MESSAGES', 'CONNECT'],
                },
                ...higherRoles.map(role => ({
                    id: role.id,
                    allow: ['VIEW_CHANNEL', 'CONNECT'],
                })),
                {
                    id: botMember.id,
                    allow: ['VIEW_CHANNEL', 'CONNECT'],
                },
            ],
        });
        return { created: true, channel: newChannel };
    } catch (error) {
        console.error(`Ошибка при создании голосового канала: ${error.message}`);
        return null;
    }
}
// Функция валидации значения настройки
async function validateSettingValue(settingKey, value, interaction, guildId) {
    let isValid = true;
    let errorMessage = '';

    // Получаем название настройки для проверки
    const settingName = i18next.t(`settings.buttons_name_${settingKey}`); // Предполагается, что названия настроек хранятся в i18next
    // Валидация значения настройки в зависимости от ключа настройки
    switch (settingKey) {
        // Валидация для строковых значений
        case 'logChannelName':
        case 'allowedgivexpRoles':
        case 'allowedremovexpRoles':
        case 'allowedvoicexpRoles':
        case 'allowedinfoxpRoles':
            if (typeof value !== 'string' || value.length === 0) {
                isValid = false;
                errorMessage = i18next.t(`settings.logchannel_error`, { settingKey });
            } else if (value === settingName) {
                isValid = false;
                errorMessage = i18next.t(`settings.value_same_as_setting_name`, { settingKey }); // Сообщение об ошибке
            }
            break;
        
        default:
            isValid = false;
            errorMessage = i18next.t(`settings.unknown_param_err`, { settingKey });
            break;
    }

    // Отправка уведомления об ошибке, если значение не прошло валидацию
    if (!isValid) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
    }

    return { isValid, value };
}
// Функция для обработки нажатий на кнопки в меню настроек
async function handleButtonInteraction(interaction, config, page) {
    if (!interaction.isButton()) return;

    try {
        await interaction.deferUpdate();
        const guildId = interaction.guild.id;
        const settingKey = interaction.customId;

        // Задержка в 0.1 секунду, чтобы бот успевал за пользователем
        await new Promise(resolve => setTimeout(resolve, 100));

        // Обработка навигации по страницам
        if (['previousPage', 'nextPage'].includes(settingKey)) {
            const newPage = settingKey === 'previousPage' ? page - 1 : page + 1;
            await displaySettings(interaction, config, newPage);
            return;
        }

        // Обработка других типов настроек, которые требуют ввода нового значения
        const newValue = await promptUserForSettingValue(interaction, settingKey);
        if (newValue !== null) {
            // Валидация нового значения
            const validation = await validateSettingValue(settingKey, newValue, interaction, guildId);
            if (validation.isValid) {
                // Сохранение нового значения в конфигурации
                config[settingKey] = validation.value;
                await saveServerSettings(guildId, config);
                const successMessage = i18next.t(`settings.sucess_update`, { settingKey });
                await interaction.followUp({ content: successMessage, ephemeral: true });
            }
        }

        // Обновляем основное меню настроек
        await displaySettings(interaction, config, page);

    } catch (error) {
        console.error('Ошибка при обработке кнопки:', error);
        if (!interaction.replied) {
            await interaction.followUp({ content: 'Произошла ошибка. Пожалуйста, попробуйте позже.', ephemeral: true });
        }
    }
}
// Функция для отображения меню настроек
async function displaySettings(interaction, config, page = 1) {
    const itemsPerPage = 5;
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const settingsEmbed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(i18next.t('settings.pages_title'))
        .setDescription(i18next.t('settings.pages_description'))
        .setFooter({ text: i18next.t(`settings.pages_number`, { page }) });
    const settings = [
        { key: 'logChannelName', name: i18next.t('settings.buttons_name_1'), value: config.logChannelName },
        { key: 'allowedgivexpRoles', name: i18next.t('settings.buttons_name_3'), value: config.allowedgivexpRoles },
        { key: 'allowedremovexpRoles', name: i18next.t('settings.buttons_name_4'), value: config.allowedremovexpRoles },
        { key: 'allowedvoicexpRoles', name: i18next.t('settings.buttons_name_5'), value: config.allowedvoicexpRoles },
        { key: 'allowedinfoxpRoles', name: i18next.t('settings.buttons_name_6'), value: config.allowedinfoxpRoles },
    ];


    const currentPageSettings = settings.slice(start, end);
    currentPageSettings.forEach(setting => {
        settingsEmbed.addFields({ name: setting.name, value: setting.value });
    });
    const buttons = currentPageSettings.map(setting => createButton(setting.key, setting.name));
    const navigationButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('previousPage')
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 1),
            new ButtonBuilder()
                .setCustomId('nextPage')
                .setLabel('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(end >= settings.length)
        );
    await interaction.editReply({ embeds: [settingsEmbed], components: [new ActionRowBuilder().addComponents(buttons), navigationButtons] });
}
// Функция для создания кнопки в меню настроек
function createButton(customId, label) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);
}
// Функция для запроса нового значения настройки у пользователя
async function promptUserForSettingValue(interaction, settingKey) {
    const filter = response => response.author.id === interaction.user.id;

    // Отправляем новое сообщение для запроса значения
    await interaction.followUp({ content: i18next.t(`settings.enter_new_value`, { settingKey }), ephemeral: true });

    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const response = collected.first();
        const newValue = response.content;

        // Проверка существования сообщения перед удалением
        if (response && response.deletable) {
            await response.delete();
        }
        return newValue;
    } catch (err) {
        console.error('Ошибка при получении нового значения настройки:', err);
        await interaction.followUp({ content: i18next.t('settings.times_is_up'), ephemeral: true });
        return null;
    }
}
async function createRoles(interaction, roleNames) {
    const messages = [];

    // Функция для генерации случайного цвета в шестнадцатеричном формате
    function getRandomColor() {
        const randomColor = Math.floor(Math.random() * 16777215).toString(16);
        return `#${randomColor.padStart(6, '0')}`; // Добавляет нули в начале, если необходимо
    }

    for (const roleName of roleNames) {
        let role = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            try {
                const color = getRandomColor(); // Генерируем случайный цвет
                role = await interaction.guild.roles.create({
                    name: roleName,
                    color: color,
                    permissions: []
                });
            } catch (error) {
                console.error(i18next.t('mutedRole_error'), { roleName });
                messages.push(i18next.t('mutedRole_error'), { roleName });
            }
        } else {
            messages.push(i18next.t('mutedRole_exists'), { roleName });
        }
    }

    return messages.join('\n');
}
// Функция для проверки и создания роли
async function ensureRolesExist(guild, roleName) {
    let role = guild.roles.cache.find(r => r.name === roleName);

    if (!role) {
        try {
            // Генерируем случайный цвет
            const randomColor = Math.floor(Math.random() * 16777215); // Генерация случайного числа от 0 до 16777215 (0xFFFFFF)

            role = await guild.roles.create({
                name: roleName,
                color: randomColor, // Используем случайный цвет
                reason: `Создание роли "${roleName}" для новых участников`
            });
        } catch (error) {
            console.error(`Ошибка при создании роли "${roleName}": ${error.message}`);
            return null; // Возвращаем null, если произошла ошибка
        }
    }

    return role;
}





// Экспортируем функции для использования в других файлах
module.exports = {
    validateUserId,
    formatDuration,
    sendPart,
    sendLongMessage,
    getPlural,
    sendPartAndDelete,
    convertToTimestamp,
    convertToMilliseconds,
    ensureDirectoryExistence,
    createMainLogChannel,
    createLogChannel,
    getOrCreateLogChannel,
    deleteMessages,
    validateSettingValue,
    handleButtonInteraction,
    displaySettings,
    createButton,
    promptUserForSettingValue,
    createRoles,
    getOrCreateVoiceChannel,
    assignNewMemberRole,
    ensureRolesExist,
    createVoiceLogChannel

};
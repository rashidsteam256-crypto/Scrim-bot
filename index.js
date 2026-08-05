const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const POSITIONS = ['CF', 'LW', 'RW', 'CM', 'GK'];

const CHARACTERS_BY_RARITY = {
  RARE: ['ISAGI', 'GAGAMARU', 'CHIGIRI'],
  EPIC: ['KURONA', 'OTOYA', 'RAICHI', 'KARASU'],
  LEGENDARY: ['NESS', 'KIYORA', 'NAGI', 'HIORI', 'BACHIRA'],
  MYTHIC: ['SHIDOU', 'RIN', 'REO', 'AIKU', 'CHARLES', 'YUKIMIYA', 'KUNIGAMI'],
  WORLDCLASS: ['KAISER', 'DON LORENZO', 'SAE'],
  LIMITEDS: [
    'ELF EMPEROR', 'EASTER YUKIMIYA', 'REAPER SAE',
    'SKELETON NAGI', 'PHANTOM ISAGI', 'FIREWORK BACHIRA',
    'SUBZERO LOKI', 'KRAMPUS BAROU'
  ]
};

// تخزين جلسات السكريم في الذاكرة عبر ID الرسالة
const scrimSessions = new Map();

// إنشاء نص لوحة السكريم
function generateScrimContent(players) {
  let content = "## Scrim!\n**Choose your position**\n\n";
  for (const pos of POSITIONS) {
    const playerInfo = players[pos];
    if (playerInfo) {
      const char = playerInfo.character ? ` [${playerInfo.character}]` : "";
      content += `**${pos}** : <@${playerInfo.userId}>${char}\n\n`;
    } else {
      content += `**${pos}** :\n\n`;
    }
  }
  return content;
}

// إنشاء المكونات (القائمة والأزرار)
function generateScrimComponents() {
  const posSelect = new StringSelectMenuBuilder()
    .setCustomId('scrim_pos_select')
    .setPlaceholder('اختر المركز...')
    .addOptions([
      { label: 'CF - مهاجم صريح', value: 'CF', emoji: '⚽' },
      { label: 'LW - جناح أيسر', value: 'LW', emoji: '🏃‍♂️' },
      { label: 'RW - جناح أيمن', value: 'RW', emoji: '🏃‍♂️' },
      { label: 'CM - خط وسط', value: 'CM', emoji: '🧠' },
      { label: 'GK - حارس مرمى', value: 'GK', emoji: '🧤' }
    ]);

  const leaveBtn = new ButtonBuilder()
    .setCustomId('scrim_leave_btn')
    .setLabel('Leave Position')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🚪');

  const kickBtn = new ButtonBuilder()
    .setCustomId('scrim_kick_btn')
    .setLabel('Kick Player')
    .setStyle(ButtonStyle.Danger);

  const row1 = new ActionRowBuilder().addComponents(posSelect);
  const row2 = new ActionRowBuilder().addComponents(leaveBtn, kickBtn);

  return [row1, row2];
}

// عند تسجيل دخول البوت وتحديث الأوامر المائلة
client.once('ready', async () => {
  console.log(`🤖 تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('scrim')
      .setDescription('إنشاء قائمة تشكيلة السكريم')
  ];

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ خطأ قاتل: لم يتم العثور على متغير البيئة DISCORD_TOKEN!');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('⏳ جاري رفع الأمر المائل /scrim إلى ديسكورد...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ تم تسجيل وتحديث الأمر /scrim بنجاح!');
  } catch (error) {
    console.error('❌ حدث خطأ أثناء تسجيل الأمر:', error);
  }
});

// التعامل مع التفاعلات (Slash Command, Select Menu, Buttons)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'scrim') {
    const players = { CF: null, LW: null, RW: null, CM: null, GK: null };
    const content = generateScrimContent(players);
    const components = generateScrimComponents();

    const response = await interaction.reply({ content, components, fetchReply: true });
    scrimSessions.set(response.id, players);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const { customId, message } = interaction;
    const players = scrimSessions.get(message.id);

    if (customId === 'scrim_pos_select') {
      if (!players) {
        return interaction.reply({ content: '❌ هذه الجلسة غير صالحة أو قديمة!', ephemeral: true });
      }

      const chosenPos = interaction.values[0];

      if (players[chosenPos] && players[chosenPos].userId !== interaction.user.id) {
        return interaction.reply({ content: '❌ هذا المركز مشغول بالفعل!', ephemeral: true });
      }

      for (const pos of POSITIONS) {
        if (players[pos] && players[pos].userId === interaction.user.id) {
          players[pos] = null;
        }
      }

      players[chosenPos] = { userId: interaction.user.id, rarity: '', character: '' };

      await message.edit({
        content: generateScrimContent(players),
        components: generateScrimComponents()
      });

      const rarityOptions = Object.keys(CHARACTERS_BY_RARITY).map(r => ({
        label: r,
        value: `${chosenPos}:${r}`
      }));

      const raritySelect = new StringSelectMenuBuilder()
        .setCustomId('scrim_rarity_select')
        .setPlaceholder('اختر الفئة...')
        .addOptions(rarityOptions);

      const row = new ActionRowBuilder().addComponents(raritySelect);
      return interaction.reply({ content: 'اختر فئة الشخصية (Rarity):', components: [row], ephemeral: true });
    }

    if (customId === 'scrim_rarity_select') {
      const [pos, rarity] = interaction.values[0].split(':');

      const charOptions = CHARACTERS_BY_RARITY[rarity].map(c => ({
        label: c,
        value: `${pos}:${c}`
      }));

      const charSelect = new StringSelectMenuBuilder()
        .setCustomId('scrim_char_select')
        .setPlaceholder('اختر الشخصية...')
        .addOptions(charOptions);

      const row = new ActionRowBuilder().addComponents(charSelect);
      return interaction.reply({ content: `اختر شخصيتك من فئة **${rarity}**:`, components: [row], ephemeral: true });
    }

    if (customId === 'scrim_char_select') {
      const [pos, character] = interaction.values[0].split(':');

      for (const [msgId, sessionData] of scrimSessions.entries()) {
        if (sessionData[pos] && sessionData[pos].userId === interaction.user.id) {
          sessionData[pos].character = character;
          try {
            const mainMsg = await interaction.channel.messages.fetch(msgId);
            await mainMsg.edit({ content: generateScrimContent(sessionData) });
          } catch (e) {
            console.error("خطأ أثناء تحديث الرسالة الرئيسية:", e);
          }
          break;
        }
      }

      return interaction.reply({ content: `✅ تم اختيار الشخصية **${character}** بنجاح!`, ephemeral: true });
    }

    if (customId === 'scrim_kick_select') {
      const posToKick = interaction.values[0];
      if (posToKick === 'none') {
        return interaction.reply({ content: 'لا يوجد لاعبون للطرد.', ephemeral: true });
      }

      const kickedUserId = players[posToKick].userId;
      players[posToKick] = null;

      await message.edit({ content: generateScrimContent(players) });
      return interaction.reply({ content: `❌ تم طرد <@${kickedUserId}> من مركز ${posToKick}.`, ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    const { customId, message } = interaction;
    const players = scrimSessions.get(message.id);

    if (!players) {
      return interaction.reply({ content: '❌ هذه الجلسة غير صالحة!', ephemeral: true });
    }

    if (customId === 'scrim_leave_btn') {
      let userFound = false;
      for (const pos of POSITIONS) {
        if (players[pos] && players[pos].userId === interaction.user.id) {
          players[pos] = null;
          userFound = true;
          break;
        }
      }

      if (userFound) {
        await message.edit({ content: generateScrimContent(players) });
        return interaction.reply({ content: '✅ تم خروجك من المركز.', ephemeral: true });
      } else {
        return interaction.reply({ content: '❌ أنت لست مسجلاً في أي مركز حالياً!', ephemeral: true });
      }
    }

    if (customId === 'scrim_kick_btn') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '🚫 ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
      }

      const kickOptions = [];
      for (const pos of POSITIONS) {
        if (players[pos]) {
          kickOptions.push({
            label: `${pos}: Player`,
            value: pos
          });
        }
      }

      if (kickOptions.length === 0) {
        kickOptions.push({ label: 'لا يوجد لاعبون للطرد', value: 'none' });
      }

      const kickSelect = new StringSelectMenuBuilder()
        .setCustomId('scrim_kick_select')
        .setPlaceholder('اختر اللاعب المراد طرده...')
        .addOptions(kickOptions);

      const row = new ActionRowBuilder().addComponents(kickSelect);
      return interaction.reply({ content: 'اختر اللاعب الذي تريد طرده من القائمة:', components: [row], ephemeral: true });
    }
  }
});

// خادم HTTP وهمي لإرضاء فحص الصحة (Health Check) في منصات الاستضافة
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is active and running on Railway!');
}).listen(PORT, () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// تسجيل دخول البوت من خلال التوكن المحفوظ في متغير البيئة Railway
const TOKEN = process.env.DISCORD_TOKEN;
if (TOKEN) {
  client.login(TOKEN);
} else {
  console.error("❌ خطأ: لم يتم ضبط متغير البيئة DISCORD_TOKEN في Railway!");
}

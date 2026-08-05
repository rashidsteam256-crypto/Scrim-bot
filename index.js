// ============================================================
// Blue Lock Rivals Discord Bot — Railway-ready standalone
// ============================================================
// Required env vars:
//   DISCORD_TOKEN      — bot token
//   DISCORD_CLIENT_ID  — application / client ID
// ============================================================

import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";

// ─────────────────────────────────────────────
// Constants & shared data
// ─────────────────────────────────────────────

const POSITIONS = ["CF", "LW", "RW", "CM", "GK"];
const TEAMS = ["HOME", "AWAY"];
const SCRIM_DURATION_MS = 10 * 60 * 1000;
const INHOUSE_DURATION_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000;

const RARITY_CHARACTERS = {
  RARE: ["Isagi", "Gagamaru", "Chigiri"],
  EPIC: ["Kurona", "Otoya", "Raichi", "Karasu"],
  LEGENDARY: ["Ness", "Kiyora", "Nagi", "Hirori", "Bachira", "King"],
  MYTHIC: ["Shidou", "Reo", "Aiku", "Rin", "Charles", "Yukimiya", "Kunigami"],
  WORLDCLASS: ["Sae", "Don Lorenzo", "Kaiser"],
  MASTERCLASS: ["Loki", "Lavinho"],
  LIMITEDS: [
    "Elf Emperor",
    "Easter Yukimiya",
    "Reaper Sae",
    "Skeleton Nagi",
    "Phantom Isagi",
    "Demon Shidou",
    "Firework Bachira",
    "Subzero Loki",
    "Krampus Barou",
  ],
};
const RARITY_KEYS = Object.keys(RARITY_CHARACTERS);

// Active sessions
const activeScrims = new Map();          // messageId -> ScrimSession
const channelScrim = new Map();          // channelId -> messageId
const activeInhouses = new Map();        // messageId -> InhouseSession
const channelInhouse = new Map();        // channelId -> messageId
const channelCooldown = new Map();       // channelId -> timestamp

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function emptyTeam() {
  return { CF: null, RW: null, LW: null, CM: null, GK: null };
}

function findPlayerPosition(session, userId) {
  for (const team of TEAMS) {
    for (const pos of POSITIONS) {
      if (session.teams[team][pos]?.userId === userId) {
        return { team, position: pos };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Scrim embed builders
// ─────────────────────────────────────────────

function buildScrimPayload(session) {
  const lines = ["# Scrim!", "**Choose your position**", ""];
  for (const pos of POSITIONS) {
    const entry = session.positions[pos];
    if (entry) {
      const char = entry.character ? ` (${entry.character})` : " (Choosing character...)";
      lines.push(`**${pos} :** <@${entry.userId}>${char}`);
    } else {
      lines.push(`**${pos} :**`);
    }
    lines.push("");
  }

  const positionSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`scrim_position:${session.messageId}`)
      .setPlaceholder("...اختر المركز")
      .addOptions(POSITIONS.map((p) => ({ label: p, value: p })))
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`scrim_change_char:${session.messageId}`)
      .setLabel("تغيير الشخصية")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`scrim_leave:${session.messageId}`)
      .setLabel("Leave Position")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`scrim_kick:${session.messageId}`)
      .setLabel("Kick Player")
      .setStyle(ButtonStyle.Danger)
  );

  return { content: lines.join("\n"), embeds: [], components: [positionSelect, buttons] };
}

function buildRaritySelect(sessionId, position) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`scrim_rarity_select:${sessionId}:${position}`)
      .setPlaceholder("اختر فئة الشخصية")
      .addOptions(RARITY_KEYS.map((r) => ({ label: r, value: r })))
  );
}

function buildCharacterSelect(sessionId, position, rarity) {
  const characters = RARITY_CHARACTERS[rarity] ?? [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`scrim_char_select:${sessionId}:${position}`)
      .setPlaceholder(`اختر شخصيتك من ${rarity}`)
      .addOptions(characters.map((c) => ({ label: c, value: c })))
  );
}

function buildKickSelect(sessionId, session) {
  const options = POSITIONS.filter((p) => session.positions[p] !== null).map((p) => {
    const entry = session.positions[p];
    return { label: `${p}: ${entry.username}`, value: `${p}:${entry.userId}` };
  });
  if (options.length === 0) options.push({ label: "لا يوجد لاعبون", value: "none" });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`scrim_kick_select:${sessionId}`)
      .setPlaceholder("اختر لاعباً لطرده")
      .addOptions(options)
  );
}

// ─────────────────────────────────────────────
// Inhouse embed builders
// ─────────────────────────────────────────────

function buildInhouseContent(session) {
  const lines = ["# IN-HOUSE!", ""];
  for (const team of TEAMS) {
    lines.push(`# ${team}`);
    for (const pos of POSITIONS) {
      const entry = session.teams[team][pos];
      if (entry) {
        const char = entry.character ? ` (${entry.character})` : " (Choosing character...)";
        lines.push(`**${pos}:** <@${entry.userId}>${char}`);
      } else {
        lines.push(`**${pos}:**`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildInhouseComponents(sessionId) {
  const positionSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`inhouse_position:${sessionId}`)
      .setPlaceholder("...اختر مركزك")
      .addOptions(POSITIONS.map((pos) => ({ label: pos, value: pos })))
  );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inhouse_change_char:${sessionId}`)
      .setLabel("تغيير الشخصية")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`inhouse_leave:${sessionId}`)
      .setLabel("Leave Position")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`inhouse_kick:${sessionId}`)
      .setLabel("Kick Player")
      .setStyle(ButtonStyle.Danger)
  );
  return [positionSelect, buttons];
}

function buildInhouseRaritySelect(sessionId, position) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`inhouse_rarity_select:${sessionId}:${position}`)
      .setPlaceholder("اختر فئة الشخصية")
      .addOptions(RARITY_KEYS.map((r) => ({ label: r, value: r })))
  );
}

function buildInhouseCharSelect(sessionId, position, rarity) {
  const characters = RARITY_CHARACTERS[rarity] ?? [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`inhouse_char_select:${sessionId}:${position}`)
      .setPlaceholder(`اختر شخصيتك من ${rarity}`)
      .addOptions(characters.map((c) => ({ label: c, value: c })))
  );
}

function buildInhouseKickSelect(sessionId, session) {
  const options = TEAMS.flatMap((team) =>
    POSITIONS.filter((p) => session.teams[team][p] !== null).map((p) => {
      const entry = session.teams[team][p];
      return { label: `${team} - ${p}: ${entry.username}`, value: `${team}:${p}:${entry.userId}` };
    })
  );
  if (options.length === 0) options.push({ label: "لا يوجد لاعبون", value: "none" });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`inhouse_kick_select:${sessionId}`)
      .setPlaceholder("اختر لاعباً لطرده")
      .addOptions(options)
  );
}

// ─────────────────────────────────────────────
// Scrim expiry
// ─────────────────────────────────────────────

async function expireScrim(sessionId, client) {
  const session = activeScrims.get(sessionId);
  if (!session) return;
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
  activeScrims.delete(sessionId);
  channelScrim.delete(session.channelId);
  try {
    const channel = await client.channels.fetch(session.channelId);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(sessionId);
      await msg.edit({ content: msg.content + "\n\n**Scrim has ended**", components: [] });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Inhouse expiry
// ─────────────────────────────────────────────

async function expireInhouse(sessionId, client) {
  const session = activeInhouses.get(sessionId);
  if (!session) return;
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
  activeInhouses.delete(sessionId);
  channelInhouse.delete(session.channelId);
  try {
    const channel = await client.channels.fetch(session.channelId);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(sessionId);
      await msg.edit({ content: msg.content + "\n\n**In-house has ended**", components: [] });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Scrim: update main message
// ─────────────────────────────────────────────

async function updateScrimMessage(sessionId, session, client) {
  try {
    const channel = await client.channels.fetch(session.channelId);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(sessionId);
      const payload = buildScrimPayload(session);
      await msg.edit({ content: payload.content, embeds: [], components: payload.components });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Inhouse: update main message
// ─────────────────────────────────────────────

async function updateInhouseMessage(sessionId, session, client) {
  try {
    const channel = await client.channels.fetch(session.channelId);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(sessionId);
      await msg.edit({
        content: buildInhouseContent(session),
        embeds: [],
        components: buildInhouseComponents(sessionId),
      });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────
// Command handlers
// ─────────────────────────────────────────────

async function handleScrimCommand(interaction) {
  const channelName = interaction.channel && "name" in interaction.channel
    ? interaction.channel.name : "";
  if (channelName === "chat العام") {
    return interaction.reply({ content: "❌ لا يمكن استخدام هذا الكوماند في **chat العام**!", flags: MessageFlags.Ephemeral });
  }

  const member = interaction.guild?.members.cache.get(interaction.user.id)
    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  const hasRole = member?.roles.cache.some((r) => r.name.toLowerCase() === "scrim hoster");

  if (!hasRole) {
    return interaction.reply({ content: "❌ هذا الكوماند مخصص لأصحاب رتبة **SCRIM HOSTER** فقط!", flags: MessageFlags.Ephemeral });
  }

  const existingId = channelScrim.get(interaction.channelId);
  if (existingId) await expireScrim(existingId, interaction.client);

  const session = {
    messageId: "",
    channelId: interaction.channelId,
    hostId: interaction.user.id,
    positions: { CF: null, LW: null, RW: null, CM: null, GK: null },
    createdAt: new Date(),
    timer: null,
  };

  const response = await interaction.reply({ content: "⏳ جاري إنشاء السكريم...", withResponse: true });
  const messageId = response.resource?.message?.id;
  if (!messageId) { return interaction.editReply({ content: "❌ فشل إنشاء السكريم." }); }

  session.messageId = messageId;
  activeScrims.set(messageId, session);
  channelScrim.set(interaction.channelId, messageId);

  session.timer = setTimeout(() => expireScrim(messageId, interaction.client), SCRIM_DURATION_MS);

  const payload = buildScrimPayload(session);
  await interaction.editReply({ content: payload.content, embeds: [], components: payload.components });
}

async function handleInhouseCommand(interaction) {
  const channelName = interaction.channel && "name" in interaction.channel
    ? interaction.channel.name : "";
  if (channelName === "chat العام") {
    return interaction.reply({ content: "❌ لا يمكن استخدام هذا الكوماند في **chat العام**!", flags: MessageFlags.Ephemeral });
  }

  const member = interaction.guild?.members.cache.get(interaction.user.id)
    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  const hasRole = member?.roles.cache.some((r) => r.name.toLowerCase() === "inhouse hoster");

  if (!hasRole) {
    return interaction.reply({ content: "❌ هذا الكوماند مخصص لأصحاب رتبة **INHOUSE HOSTER** فقط!", flags: MessageFlags.Ephemeral });
  }

  const now = Date.now();
  const lastCreated = channelCooldown.get(interaction.channelId);
  if (lastCreated !== undefined) {
    const remaining = COOLDOWN_MS - (now - lastCreated);
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000);
      return interaction.reply({ content: `⏳ يجب الانتظار **${mins} دقيقة** قبل إنشاء إن-هاوس جديد.`, flags: MessageFlags.Ephemeral });
    }
  }

  const existingId = channelInhouse.get(interaction.channelId);
  if (existingId) await expireInhouse(existingId, interaction.client);

  const session = {
    messageId: "",
    channelId: interaction.channelId,
    hostId: interaction.user.id,
    teams: { HOME: emptyTeam(), AWAY: emptyTeam() },
    createdAt: new Date(),
    timer: null,
  };

  const response = await interaction.reply({ content: "⏳ جاري إنشاء الإن-هاوس...", withResponse: true });
  const messageId = response.resource?.message?.id;
  if (!messageId) { return interaction.editReply({ content: "❌ فشل إنشاء الإن-هاوس." }); }

  session.messageId = messageId;
  activeInhouses.set(messageId, session);
  channelInhouse.set(interaction.channelId, messageId);
  channelCooldown.set(interaction.channelId, Date.now());

  session.timer = setTimeout(() => expireInhouse(messageId, interaction.client), INHOUSE_DURATION_MS);

  await interaction.editReply({
    content: buildInhouseContent(session),
    embeds: [],
    components: buildInhouseComponents(messageId),
  });
}

// ─────────────────────────────────────────────
// Scrim interaction handlers
// ─────────────────────────────────────────────

async function handleScrimInteraction(interaction) {
  const id = interaction.customId;
  if (id.startsWith("scrim_position:"))      return handleScrimPositionSelect(interaction);
  if (id.startsWith("scrim_rarity_select:")) return handleScrimRaritySelect(interaction);
  if (id.startsWith("scrim_char_select:"))   return handleScrimCharSelect(interaction);
  if (id.startsWith("scrim_leave:"))         return handleScrimLeave(interaction);
  if (id.startsWith("scrim_kick:"))          return handleScrimKickButton(interaction);
  if (id.startsWith("scrim_kick_select:"))   return handleScrimKickSelect(interaction);
  if (id.startsWith("scrim_change_char:"))   return handleScrimChangeChar(interaction);
}

async function handleScrimPositionSelect(interaction) {
  const [, sessionId] = interaction.customId.split(":");
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ هذا السكريم لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const position = interaction.values[0];
  const userId = interaction.user.id;
  const username = interaction.user.username;

  for (const pos of POSITIONS) {
    if (session.positions[pos]?.userId === userId) session.positions[pos] = null;
  }

  if (session.positions[position] !== null) {
    return interaction.reply({ content: `❌ مركز **${position}** محجوز بالفعل!`, flags: MessageFlags.Ephemeral });
  }

  session.positions[position] = { userId, username, character: null };
  await updateScrimMessage(sessionId, session, interaction.client);
  await interaction.reply({
    content: `✅ اخترت مركز **${position}**! الآن اختر **فئة** شخصيتك:`,
    components: [buildRaritySelect(sessionId, position)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleScrimRaritySelect(interaction) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const position = parts[2];
  const rarity = interaction.values[0];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.update({ content: "❌ السكريم لم يعد موجوداً.", components: [] });
  await interaction.update({
    content: `فئة **${rarity}** — اختر شخصيتك:`,
    components: [buildCharacterSelect(sessionId, position, rarity)],
  });
}

async function handleScrimCharSelect(interaction) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const position = parts[2];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.update({ content: "❌ السكريم لم يعد موجوداً.", components: [] });

  const character = interaction.values[0];
  if (session.positions[position]?.userId !== interaction.user.id) {
    return interaction.update({ content: "❌ هذا المركز ليس لك!", components: [] });
  }
  session.positions[position].character = character;
  await interaction.update({ content: `✅ اخترت **${character}** في مركز **${position}**!`, components: [] });
  await updateScrimMessage(sessionId, session, interaction.client);
}

async function handleScrimLeave(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ السكريم لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  let found = false;
  for (const pos of POSITIONS) {
    if (session.positions[pos]?.userId === userId) { session.positions[pos] = null; found = true; }
  }
  if (!found) return interaction.reply({ content: "❌ أنت لست في هذا السكريم!", flags: MessageFlags.Ephemeral });

  await interaction.reply({ content: "✅ غادرت السكريم.", flags: MessageFlags.Ephemeral });
  await updateScrimMessage(sessionId, session, interaction.client);
}

async function handleScrimKickButton(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ السكريم لم يعد موجوداً.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== session.hostId) return interaction.reply({ content: "❌ فقط مضيف السكريم يمكنه طرد اللاعبين!", flags: MessageFlags.Ephemeral });
  const hasPlayers = POSITIONS.some((p) => session.positions[p] !== null);
  if (!hasPlayers) return interaction.reply({ content: "❌ لا يوجد لاعبون في السكريم.", flags: MessageFlags.Ephemeral });
  await interaction.reply({ content: "اختر اللاعب الذي تريد طرده:", components: [buildKickSelect(sessionId, session)], flags: MessageFlags.Ephemeral });
}

async function handleScrimKickSelect(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.update({ content: "❌ السكريم لم يعد موجوداً.", components: [] });
  if (interaction.user.id !== session.hostId) return interaction.update({ content: "❌ فقط مضيف السكريم يمكنه طرد اللاعبين!", components: [] });

  const value = interaction.values[0];
  if (value === "none") return interaction.update({ content: "لا يوجد لاعبون.", components: [] });

  const [pos] = value.split(":");
  const kicked = session.positions[pos];
  if (!kicked) return interaction.update({ content: "❌ اللاعب لم يعد موجوداً.", components: [] });

  session.positions[pos] = null;
  await interaction.update({ content: `✅ تم طرد **${kicked.username}** من مركز **${pos}**.`, components: [] });
  await updateScrimMessage(sessionId, session, interaction.client);
}

async function handleScrimChangeChar(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeScrims.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ السكريم لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  let userPosition = null;
  for (const pos of POSITIONS) {
    if (session.positions[pos]?.userId === userId) userPosition = pos;
  }
  if (!userPosition) return interaction.reply({ content: "❌ أنت لست في هذا السكريم! اختر مركزاً أولاً.", flags: MessageFlags.Ephemeral });

  await interaction.reply({
    content: `اختر **فئة** شخصيتك الجديدة في مركز **${userPosition}**:`,
    components: [buildRaritySelect(sessionId, userPosition)],
    flags: MessageFlags.Ephemeral,
  });
}

// ─────────────────────────────────────────────
// Inhouse interaction handlers
// ─────────────────────────────────────────────

async function handleInhouseInteraction(interaction) {
  const id = interaction.customId;
  if (id.startsWith("inhouse_position:"))      return handleInhousePositionSelect(interaction);
  if (id.startsWith("inhouse_rarity_select:")) return handleInhouseRaritySelect(interaction);
  if (id.startsWith("inhouse_char_select:"))   return handleInhouseCharSelect(interaction);
  if (id.startsWith("inhouse_leave:"))         return handleInhouseLeave(interaction);
  if (id.startsWith("inhouse_kick:"))          return handleInhouseKickButton(interaction);
  if (id.startsWith("inhouse_kick_select:"))   return handleInhouseKickSelect(interaction);
  if (id.startsWith("inhouse_change_char:"))   return handleInhouseChangeChar(interaction);
}

async function handleInhousePositionSelect(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ الإن-هاوس لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const position = interaction.values[0];
  const userId = interaction.user.id;
  const username = interaction.user.username;

  for (const t of TEAMS) {
    for (const p of POSITIONS) {
      if (session.teams[t][p]?.userId === userId) session.teams[t][p] = null;
    }
  }

  const freeTeams = TEAMS.filter((t) => session.teams[t][position] === null);
  if (freeTeams.length === 0) {
    return interaction.reply({ content: `❌ مركز **${position}** ممتلئ في كلا الفريقين!`, flags: MessageFlags.Ephemeral });
  }

  const assignedTeam = freeTeams[Math.floor(Math.random() * freeTeams.length)];
  session.teams[assignedTeam][position] = { userId, username, character: null };

  await updateInhouseMessage(sessionId, session, interaction.client);
  await interaction.reply({
    content: `✅ تم تعيينك في فريق **${assignedTeam}** مركز **${position}**!\nالآن اختر **فئة** شخصيتك:`,
    components: [buildInhouseRaritySelect(sessionId, position)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleInhouseRaritySelect(interaction) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const position = parts[2];
  const rarity = interaction.values[0];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.update({ content: "❌ الإن-هاوس لم يعد موجوداً.", components: [] });
  await interaction.update({
    content: `فئة **${rarity}** — اختر شخصيتك:`,
    components: [buildInhouseCharSelect(sessionId, position, rarity)],
  });
}

async function handleInhouseCharSelect(interaction) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const position = parts[2];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.update({ content: "❌ الإن-هاوس لم يعد موجوداً.", components: [] });

  const found = findPlayerPosition(session, interaction.user.id);
  if (!found || found.position !== position) return interaction.update({ content: "❌ هذا المركز ليس لك!", components: [] });

  const character = interaction.values[0];
  session.teams[found.team][position].character = character;
  await interaction.update({ content: `✅ اخترت **${character}** في **${found.team} - ${position}**!`, components: [] });
  await updateInhouseMessage(sessionId, session, interaction.client);
}

async function handleInhouseLeave(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ الإن-هاوس لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const found = findPlayerPosition(session, interaction.user.id);
  if (!found) return interaction.reply({ content: "❌ أنت لست في هذا الإن-هاوس!", flags: MessageFlags.Ephemeral });

  session.teams[found.team][found.position] = null;
  await interaction.reply({ content: "✅ غادرت الإن-هاوس.", flags: MessageFlags.Ephemeral });
  await updateInhouseMessage(sessionId, session, interaction.client);
}

async function handleInhouseKickButton(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ الإن-هاوس لم يعد موجوداً.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== session.hostId) return interaction.reply({ content: "❌ فقط من أنشأ الإن-هاوس يمكنه طرد اللاعبين!", flags: MessageFlags.Ephemeral });

  const hasPlayers = TEAMS.some((t) => POSITIONS.some((p) => session.teams[t][p] !== null));
  if (!hasPlayers) return interaction.reply({ content: "❌ لا يوجد لاعبون في الإن-هاوس.", flags: MessageFlags.Ephemeral });

  await interaction.reply({ content: "اختر اللاعب الذي تريد طرده:", components: [buildInhouseKickSelect(sessionId, session)], flags: MessageFlags.Ephemeral });
}

async function handleInhouseKickSelect(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.update({ content: "❌ الإن-هاوس لم يعد موجوداً.", components: [] });
  if (interaction.user.id !== session.hostId) return interaction.update({ content: "❌ فقط من أنشأ الإن-هاوس يمكنه طرد اللاعبين!", components: [] });

  const value = interaction.values[0];
  if (value === "none") return interaction.update({ content: "لا يوجد لاعبون.", components: [] });

  const [team, pos] = value.split(":");
  const kicked = session.teams[team][pos];
  if (!kicked) return interaction.update({ content: "❌ اللاعب لم يعد موجوداً.", components: [] });

  session.teams[team][pos] = null;
  await interaction.update({ content: `✅ تم طرد **${kicked.username}** من **${team} - ${pos}**.`, components: [] });
  await updateInhouseMessage(sessionId, session, interaction.client);
}

async function handleInhouseChangeChar(interaction) {
  const sessionId = interaction.customId.split(":")[1];
  const session = activeInhouses.get(sessionId);
  if (!session) return interaction.reply({ content: "❌ الإن-هاوس لم يعد موجوداً.", flags: MessageFlags.Ephemeral });

  const found = findPlayerPosition(session, interaction.user.id);
  if (!found) return interaction.reply({ content: "❌ أنت لست في هذا الإن-هاوس! اختر مركزاً أولاً.", flags: MessageFlags.Ephemeral });

  await interaction.reply({
    content: `اختر **فئة** شخصيتك الجديدة في **${found.team} - ${found.position}**:`,
    components: [buildInhouseRaritySelect(sessionId, found.position)],
    flags: MessageFlags.Ephemeral,
  });
}

// ─────────────────────────────────────────────
// Register slash commands
// ─────────────────────────────────────────────

async function registerCommands(token, clientId) {
  const commands = [
    new SlashCommandBuilder()
      .setName("scrim")
      .setDescription("ابدأ سكريم جديد للعبة Blue Lock Rivals")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("inhouse")
      .setDescription("ابدأ إن-هاوس جديد فريقين HOME وAWAY")
      .toJSON(),
  ];

  const rest = new REST().setToken(token);
  console.log("[Bot] Registering slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("[Bot] Slash commands registered.");
}

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    console.error("[Bot] ERROR: DISCORD_TOKEN and DISCORD_CLIENT_ID env vars are required.");
    process.exit(1);
  }

  await registerCommands(token, clientId);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[Bot] Logged in as ${c.user.tag}`);
    c.user.setPresence({ status: "idle" });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "scrim")   await handleScrimCommand(interaction);
        if (interaction.commandName === "inhouse") await handleInhouseCommand(interaction);
      } else if (interaction.isStringSelectMenu() || interaction.isButton()) {
        if (interaction.customId.startsWith("inhouse_")) {
          await handleInhouseInteraction(interaction);
        } else {
          await handleScrimInteraction(interaction);
        }
      }
    } catch (err) {
      console.error("[Bot] Error handling interaction:", err);
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("[Bot] Fatal error:", err);
  process.exit(1);
});

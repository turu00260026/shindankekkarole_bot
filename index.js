/**
 * shindanrole-bot (Discord.js v14)
 *
 * ✅ 元の形（スッキリ版）
 * - チャンネルに常設するのは「診断結果を選ぶ」ボタン（＋説明）とリセット案内
 * - ボタンを押した人だけに、4カテゴリのプルダウン（＋リセットボタン）をephemeral表示
 * - 選択すると診断ロールを付与（無ければ自動作成）
 * - リセットは「診断ロールだけ」外す（他ロールは触らない）
 * - /shindanrole は指定チャンネルでのみ設置（TARGET_CHANNEL_ID）
 *
 * 必要な環境変数:
 *   DISCORD_TOKEN=xxxxxxxx
 *   TARGET_CHANNEL_ID=123456789012345678   (設置を許可するチャンネルID)
 */

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// ====== env ======
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || "";

// ====== 設定 ======
const SINGLE_ROLE_MODE = true; // true: 診断ロールは1人1つだけ
const PANEL_TAG = "shindanrole_panel_v2";

// ====== 診断結果（36） ======
const CREATOR = [
  "アイデアの魔法使い",
  "センス磨きのプロ",
  "こだわり職人",
  "心を動かす表現者",
  "温もりデザイナー",
  "物語作家",
  "美の演出家",
  "美の設計士",
  "丁寧職人",
];

const ANALYST = [
  "未来の開拓者",
  "発見クリエイター",
  "知の探究者",
  "知恵袋リーダー",
  "優しい解決者",
  "静かな守護者",
  "整理上手リーダー",
  "確実実行者",
  "完成度の番人",
];

const SUPPORTER = [
  "夢のプロデューサー",
  "心温まる表現者",
  "感情の詩人",
  "心技一体リーダー",
  "寄り添う達人",
  "影の補佐官",
  "絆の育成者",
  "調和の架け橋",
  "気配り上手",
];

const MANAGER = [
  "創造の実行者",
  "美と効率の融合者",
  "時間の魔術師",
  "最適化マスター",
  "信頼の実務派",
  "秩序の番人",
  "成長の導き手",
  "段取り上手",
  "気遣いの達人",
];

const RESULT_NAMES = [...CREATOR, ...ANALYST, ...SUPPORTER, ...MANAGER];

// ====== customId ======
const OPEN_BTN_ID = "btn_open_shindanrole";
const RESET_BTN_ID = "btn_reset_roles";

const SELECT_CREATOR_ID = "select_creator";
const SELECT_ANALYST_ID = "select_analyst";
const SELECT_SUPPORTER_ID = "select_supporter";
const SELECT_MANAGER_ID = "select_manager";

// ====== client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ====== slash command register ======
async function registerSlashCommands() {
  const shindanrole = new SlashCommandBuilder()
    .setName("shindanrole")
    .setDescription("診断結果登録のランチャー（ボタン）を指定チャンネルに設置します（管理用）");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [shindanrole.toJSON()],
  });
}

// ====== utils ======
function toOptions(names) {
  return names.map((n) => ({ label: n, value: n }));
}

function isTargetChannel(interaction) {
  if (!TARGET_CHANNEL_ID) return true;
  return interaction.channelId === TARGET_CHANNEL_ID;
}

async function safeEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

// ====== UI builders ======
function buildLauncherContent() {
  return (
    "👇 診断結果の登録はこちら\n" +
    "（ボタンを押すと、診断結果の選択画面が開きます）\n\n" +
    "結果の選択を間違ってしまった場合は、下のボタンでロールをリセットしてからえらびなおしてね\n\n" +
    `#${PANEL_TAG}`
  );
}

function buildLauncherComponents() {
  const rowOpen = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(OPEN_BTN_ID).setLabel("診断結果を選ぶ").setStyle(ButtonStyle.Primary)
  );

  const rowReset = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESET_BTN_ID)
      .setLabel("診断ロールをリセット")
      .setStyle(ButtonStyle.Danger)
  );

  // 「リセットボタンを、診断結果を選ぶボタンの下」にする＝行を分けて順番をこうする
  return [rowOpen, rowReset];
}

function buildEphemeralPickerComponents() {
  // SelectMenuは「1行に1個」ルールなので、必ずActionRowを分ける
  const rowCreator = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_CREATOR_ID)
      .setPlaceholder("【クリエイタータイプ】から選択")
      .addOptions(toOptions(CREATOR))
  );

  const rowAnalyst = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_ANALYST_ID)
      .setPlaceholder("【アナリストタイプ】から選択")
      .addOptions(toOptions(ANALYST))
  );

  const rowSupporter = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_SUPPORTER_ID)
      .setPlaceholder("【サポータータイプ】から選択")
      .addOptions(toOptions(SUPPORTER))
  );

  const rowManager = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_MANAGER_ID)
      .setPlaceholder("【マネージャータイプ】から選択")
      .addOptions(toOptions(MANAGER))
  );

  const rowReset = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(RESET_BTN_ID).setLabel("診断ロールをリセット").setStyle(ButtonStyle.Danger)
  );

  return [rowCreator, rowAnalyst, rowSupporter, rowManager, rowReset];
}

// ====== role logic ======
async function applyRoleByName(interaction, roleName) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await safeEphemeral(interaction, "ギルド/メンバー情報が取れなかった…");
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await safeEphemeral(
      interaction,
      "Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！"
    );
    return;
  }

  let role = guild.roles.cache.find((r) => r.name === roleName);

  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      mentionable: false,
      hoist: false,
      permissions: [],
      reason: "診断結果ロールを自動作成",
    });
  }

  const botHighest = me.roles.highest;
  if (botHighest.comparePositionTo(role) <= 0) {
    await safeEphemeral(
      interaction,
      `ロール「${roleName}」を付与できない…\n` +
        `原因：Botのロールが付与対象ロールより下にある可能性が高いよ。\n` +
        `サーバー設定 → ロール で Botロールを上に移動してね！`
    );
    return;
  }

  if (SINGLE_ROLE_MODE) {
    const removeTargets = member.roles.cache.filter(
      (r) => RESULT_NAMES.includes(r.name) && r.id !== role.id
    );
    if (removeTargets.size > 0) {
      await member.roles.remove(removeTargets);
    }
  }

  await member.roles.add(role);
  await safeEphemeral(interaction, `✅ 登録OK！ → **${roleName}**（ロール付与済み）`);
}

async function resetDiagnosisRoles(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await safeEphemeral(interaction, "ギルド/メンバー情報が取れなかった…");
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await safeEphemeral(
      interaction,
      "Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！"
    );
    return;
  }

  const targets = member.roles.cache.filter((r) => RESULT_NAMES.includes(r.name));
  if (targets.size === 0) {
    await safeEphemeral(interaction, "外す診断ロールが見つからなかったよ（すでにリセット済みかも）");
    return;
  }

  await member.roles.remove(targets);
  await safeEphemeral(interaction, "✅ 診断ロールをリセットしたよ！もう一度選び直してね。");
}

// ====== launcher send (dedupe) ======
async function ensureLauncherInChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, reason: "channel_not_found" };

  const msgs = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    const exists = msgs.find(
      (m) => m.author?.id === client.user.id && (m.content || "").includes(`#${PANEL_TAG}`)
    );
    if (exists) return { ok: true, already: true };
  }

  await channel.send({
    content: buildLauncherContent(),
    components: buildLauncherComponents(),
  });

  return { ok: true, already: false };
}

// ====== ready ======
client.once("ready", async () => {
  try {
    await registerSlashCommands();
    console.log("✅ スラッシュコマンド登録完了");
  } catch (e) {
    console.error("❌ スラッシュコマンド登録失敗", e);
  }

  // 起動時に自動設置（TARGET_CHANNEL_IDがある場合）
  if (TARGET_CHANNEL_ID) {
    for (const [, guild] of client.guilds.cache) {
      try {
        const res = await ensureLauncherInChannel(guild, TARGET_CHANNEL_ID);
        if (res.ok && res.already) console.log("ℹ️ 診断ランチャーは既に設置済み");
        if (res.ok && !res.already) console.log("✅ 診断ランチャーを設置しました");
      } catch (e) {
        console.log("⚠️ 起動時の自動設置はスキップ（権限/チャンネル未存在の可能性）");
      }
    }
  }

  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== interactions ======
client.on("interactionCreate", async (interaction) => {
  try {
    // ---- slash command ----
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "shindanrole") {
        if (!isTargetChannel(interaction)) {
          await safeEphemeral(interaction, "このコマンドボタンは指定チャンネルで使ってね！");
          return;
        }

        const res = await ensureLauncherInChannel(interaction.guild, interaction.channelId);
        if (res.ok && res.already) {
          await safeEphemeral(interaction, "このチャンネルには既にランチャーがあるよ！");
        } else if (res.ok) {
          await safeEphemeral(interaction, "✅ ランチャー（ボタン）を設置したよ！");
        } else {
          await safeEphemeral(interaction, "設置に失敗した…（チャンネル取得できないかも）");
        }
      }
      return;
    }

    // ---- launcher button ----
    if (interaction.isButton()) {
      if (interaction.customId === OPEN_BTN_ID) {
        await interaction.reply({
          content:
            "あなたの診断結果を、該当タイプのプルダウンから選んでください。\n" +
            "（選び間違えた場合は、下のボタンでロールをリセットしてからえらびなおしてね）",
          components: buildEphemeralPickerComponents(),
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === RESET_BTN_ID) {
        await resetDiagnosisRoles(interaction);
        return;
      }

      return;
    }

    // ---- select menus ----
    if (interaction.isStringSelectMenu()) {
      const roleName = interaction.values?.[0];
      if (!roleName) {
        await safeEphemeral(interaction, "選択値が取れなかった…");
        return;
      }

      if (
        interaction.customId === SELECT_CREATOR_ID ||
        interaction.customId === SELECT_ANALYST_ID ||
        interaction.customId === SELECT_SUPPORTER_ID ||
        interaction.customId === SELECT_MANAGER_ID
      ) {
        await applyRoleByName(interaction, roleName);
      }
      return;
    }
  } catch (e) {
    console.error("❌ interaction error:", e);
    try {
      await safeEphemeral(interaction, "ごめん、処理中にエラーが出た…（ログを見てね）");
    } catch (_) {}
  }
});

// ====== start ======
if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN が未設定です。RailwayのVariablesにDISCORD_TOKENを入れてください。");
  process.exit(1);
}

client.login(TOKEN);

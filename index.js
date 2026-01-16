/**
 * shindanrole-bot (Discord.js v14)
 * - /shindanrole: 指定チャンネルに「診断結果選択」パネルを設置
 * - 4カテゴリのプルダウン（各ActionRowに1つずつ）でロール付与
 * - 「診断ロールをリセット」ボタンで診断ロールだけ外す（他ロールは触らない）
 * - 診断ロールが無ければ自動作成（権限は空で安全）
 *
 * 必要な環境変数:
 *   DISCORD_TOKEN=xxxxxxxx
 *   TARGET_CHANNEL_ID=123456789012345678   (設置を許可するチャンネルID)
 *
 * 推奨: RailwayのVariablesに設定
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

// ====== 環境変数 ======
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || "";

// ====== 設定 ======
const SINGLE_ROLE_MODE = true; // true: 診断ロールは1人1つだけ（選び直すと他の診断ロールを外す）
const PANEL_TAG = "shindanrole_panel"; // 再設置判定用のキーワード

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
const SELECT_CREATOR_ID = "select_creator";
const SELECT_ANALYST_ID = "select_analyst";
const SELECT_SUPPORTER_ID = "select_supporter";
const SELECT_MANAGER_ID = "select_manager";
const RESET_BTN_ID = "btn_reset_roles";

// ====== Discord Client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ====== Slash command register ======
async function registerSlashCommands() {
  const shindanrole = new SlashCommandBuilder()
    .setName("shindanrole")
    .setDescription("診断結果の選択パネルを指定チャンネルに設置します（管理用）");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [shindanrole.toJSON()],
  });
}

// ====== ユーティリティ ======
function toOptions(names) {
  return names.map((n) => ({ label: n, value: n }));
}

function isTargetChannel(interaction) {
  if (!TARGET_CHANNEL_ID) return true; // 未設定なら制限なし
  return interaction.channelId === TARGET_CHANNEL_ID;
}

async function safeReply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

// ====== ロール付与（無ければ作る） ======
async function applyRoleByName(interaction, roleName) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await safeReply(interaction, "ギルド/メンバー情報が取れなかった…");
    return;
  }

  // Botの権限チェック
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await safeReply(
      interaction,
      "Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！"
    );
    return;
  }

  // ① ロール名で探す
  let role = guild.roles.cache.find((r) => r.name === roleName);

  // ② 無ければ作る（安全：権限なし）
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      mentionable: false,
      hoist: false,
      permissions: [],
      reason: "診断結果ロールを自動作成",
    });
  }

  // ロール階層チェック（Botの一番上のロールより上は付与できない）
  const botHighest = me.roles.highest;
  if (botHighest.comparePositionTo(role) <= 0) {
    await safeReply(
      interaction,
      `ロール「${roleName}」を付与できない…\n原因：Botのロールが付与対象ロールより下にある可能性が高いよ。\nサーバー設定 → ロール で Botロールを上に移動してね！`
    );
    return;
  }

  // 「1人1つだけ」運用なら他の診断ロールを外す（診断ロール以外は絶対に触らない）
  if (SINGLE_ROLE_MODE) {
    const removeTargets = member.roles.cache.filter(
      (r) => RESULT_NAMES.includes(r.name) && r.id !== role.id
    );
    if (removeTargets.size > 0) {
      await member.roles.remove(removeTargets);
    }
  }

  // 付与
  await member.roles.add(role);

  await safeReply(interaction, `✅ 登録OK！ → **${roleName}**（ロール付与済み）`);
}

// ====== 診断ロールだけリセット（他ロールは触らない） ======
async function resetDiagnosisRoles(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await safeReply(interaction, "ギルド/メンバー情報が取れなかった…");
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await safeReply(
      interaction,
      "Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！"
    );
    return;
  }

  const targets = member.roles.cache.filter((r) => RESULT_NAMES.includes(r.name));
  if (targets.size === 0) {
    await safeReply(interaction, "外す診断ロールが見つからなかったよ（すでにリセット済みかも）");
    return;
  }

  await member.roles.remove(targets);
  await safeReply(interaction, "✅ 診断ロールをリセットしたよ！もう一度選び直してね。");
}

// ====== パネル（4プルダウン＋説明＋リセット） ======
function buildPanelComponents() {
  // SelectMenuは「1 ActionRow に1個まで」ルール！
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
    new ButtonBuilder()
      .setCustomId(RESET_BTN_ID)
      .setLabel("診断ロールをリセット")
      .setStyle(ButtonStyle.Danger)
  );

  return [rowCreator, rowAnalyst, rowSupporter, rowManager, rowReset];
}

function buildPanelContent() {
  return (
    "👇 診断結果の登録はこちら\n" +
    "あなたの診断結果を、該当タイプのプルダウンから選んでください。\n" +
    "（選び間違えた場合は、下のボタンでロールをリセットしてからえらびなおしてね）\n\n" +
    `#${PANEL_TAG}`
  );
}

// ====== 指定チャンネルにパネルを設置（重複設置防止） ======
async function ensurePanelInChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, reason: "channel_not_found" };

  // 直近のメッセージを見て、すでにパネルがあるか確認
  const msgs = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (msgs) {
    const exists = msgs.find(
      (m) => m.author?.id === client.user.id && (m.content || "").includes(`#${PANEL_TAG}`)
    );
    if (exists) return { ok: true, already: true };
  }

  await channel.send({
    content: buildPanelContent(),
    components: buildPanelComponents(),
  });

  return { ok: true, already: false };
}

// ====== Ready ======
client.once("ready", async () => {
  try {
    await registerSlashCommands();
    console.log("✅ スラッシュコマンド登録完了");
  } catch (e) {
    console.error("❌ スラッシュコマンド登録失敗", e);
  }

  // TARGET_CHANNEL_ID があれば、起動時に自動設置を試みる
  if (TARGET_CHANNEL_ID) {
    // Botが入っている全ギルドに対して、指定チャンネルがあるところだけ設置
    for (const [, guild] of client.guilds.cache) {
      try {
        const res = await ensurePanelInChannel(guild, TARGET_CHANNEL_ID);
        if (res.ok && res.already) console.log("ℹ️ 診断ランチャーは既に設置済み");
        if (res.ok && !res.already) console.log("✅ 診断ランチャーを設置しました");
      } catch (e) {
        console.log("⚠️ 起動時の自動設置はスキップ（権限/チャンネル未存在の可能性）");
      }
    }
  }

  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== Interactions ======
client.on("interactionCreate", async (interaction) => {
  try {
    // ---- Slash command ----
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "shindanrole") {
        if (!isTargetChannel(interaction)) {
          await safeReply(interaction, "このコマンドは指定チャンネルで使ってね！");
          return;
        }

        const res = await ensurePanelInChannel(interaction.guild, interaction.channelId);
        if (res.ok && res.already) {
          await safeReply(interaction, "このチャンネルには既にパネルがあるよ！");
        } else if (res.ok) {
          await safeReply(interaction, "✅ 診断パネルを設置したよ！");
        } else {
          await safeReply(interaction, "パネル設置に失敗した…（チャンネル取得できないかも）");
        }
      }
      return;
    }

    // ---- Select menus ----
    if (interaction.isStringSelectMenu()) {
      const roleName = interaction.values?.[0];
      if (!roleName) {
        await safeReply(interaction, "選択値が取れなかった…");
        return;
      }

      // どのメニューでも処理は同じ：選ばれた役職名を付与
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

    // ---- Buttons ----
    if (interaction.isButton()) {
      if (interaction.customId === RESET_BTN_ID) {
        await resetDiagnosisRoles(interaction);
      }
      return;
    }
  } catch (e) {
    console.error("❌ interaction error:", e);
    try {
      await safeReply(interaction, "ごめん、処理中にエラーが出た…（ログを見てね）");
    } catch (_) {}
  }
});

// ====== Start ======
if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN が未設定です。RailwayのVariablesにDISCORD_TOKENを入れてください。");
  process.exit(1);
}

client.login(TOKEN);

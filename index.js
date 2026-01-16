/**
 * shindanrole-bot (index.js)
 * 機能:
 * - /shindanrole : 4カテゴリのプルダウン(4つ) + リセットボタン をephemeral表示
 * - /shindanrole_reset : 自分の診断ロール(36種)のみを全削除
 * - チャンネルに常設の「🧠 診断をはじめる」ボタンを自動設置（重複投稿しない）
 * - 結果ロールは存在しなければ自動作成して付与（権限は空）
 * - 診断ロールは1人1つ運用（他の診断ロールを外して付与）
 *
 * 必要:
 * - .env に DISCORD_TOKEN=xxxx
 * - TARGET_CHANNEL_ID を指定
 * - Botに「ロール管理(Manage Roles)」権限
 * - Botロールを十分上に（作成/付与するロールより上）
 */

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// =====================
// 設定：ここだけ埋めてね
// =====================
const TARGET_CHANNEL_ID = "1461615954055397396";

// 常設「診断をはじめる」ボタン
const OPEN_SHINDANROLE_BTN_ID = "open_shindanrole_btn";
// ephemeral内の「診断ロールをリセット」ボタン
const RESET_BTN_ID = "shindanrole_reset_btn";

// 診断結果：カテゴリ別（各9件）
const CATEGORIES = [
  {
    key: "creator",
    title: "クリエイタータイプ",
    items: [
      "アイデアの魔法使い",
      "センス磨きのプロ",
      "こだわり職人",
      "心を動かす表現者",
      "温もりデザイナー",
      "物語作家",
      "美の演出家",
      "美の設計士",
      "丁寧職人",
    ],
  },
  {
    key: "analyst",
    title: "アナリストタイプ",
    items: [
      "未来の開拓者",
      "発見クリエイター",
      "知の探究者",
      "知恵袋リーダー",
      "優しい解決者",
      "静かな守護者",
      "整理上手リーダー",
      "確実実行者",
      "完成度の番人",
    ],
  },
  {
    key: "supporter",
    title: "サポータータイプ",
    items: [
      "夢のプロデューサー",
      "心温まる表現者",
      "感情の詩人",
      "心技一体リーダー",
      "寄り添う達人",
      "影の補佐官",
      "絆の育成者",
      "調和の架け橋",
      "気配り上手",
    ],
  },
  {
    key: "manager",
    title: "マネージャータイプ",
    items: [
      "創造の実行者",
      "美と効率の融合者",
      "時間の魔術師",
      "最適化マスター",
      "信頼の実務派",
      "秩序の番人",
      "成長の導き手",
      "段取り上手",
      "気遣いの達人",
    ],
  },
];

// 全結果一覧（リセットや「1人1つ運用」で外す対象）
const ALL_RESULT_NAMES = CATEGORIES.flatMap((c) => c.items);

// 診断ロールは「1人1つだけ」にするなら true（おすすめ）
const SINGLE_ROLE_MODE = true;

// =====================
// Botクライアント
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// =====================
// コマンド登録（起動時に実行）
// =====================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("shindanrole")
      .setDescription("診断結果を登録してロールを付与します"),
    new SlashCommandBuilder()
      .setName("shindanrole_reset")
      .setDescription("自分の診断ロールを全部外してやり直します"),
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = (await rest.get(Routes.oauth2CurrentApplication())).id;

  await rest.put(Routes.applicationCommands(appId), {
    body: commands.map((c) => c.toJSON()),
  });

  console.log("✅ スラッシュコマンド登録完了");
}

async function ensureTargetChannel(interaction) {
  if (interaction.channelId !== TARGET_CHANNEL_ID) {
    await interaction.reply({
      content: "このコマンド/ボタンは指定チャンネルで使ってね！",
      ephemeral: true,
    });
    return false;
  }
  return true;
}

// 返信ヘルパー（reply済みならfollowUp）
function makeResponder(interaction) {
  return async (content) => {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({ content, ephemeral: true });
    }
    return interaction.reply({ content, ephemeral: true });
  };
}

// UI生成（4プルダウン + リセットボタン）
function buildShindanroleUI() {
  const selectRows = CATEGORIES.map((cat) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shindanrole_cat_${cat.key}`)
        .setPlaceholder(`【${cat.title}】から選択`)
        .addOptions(
          cat.items.map((name) => ({
            label: name,
            value: name, // valueはロール名と同じ
          }))
        )
    )
  );

  // DiscordのActionRowは最大5行まで。4 select + 1 button = 5行でぴったり
  const resetRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESET_BTN_ID)
      .setLabel("診断ロールをリセット")
      .setStyle(ButtonStyle.Danger)
  );

  return { selectRows, resetRow };
}

async function applyRoleByName(interaction, roleName) {
  const respond = makeResponder(interaction);
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await respond("ギルド/メンバー情報が取れなかった…");
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await respond("Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！");
    return;
  }

  // ① ロール名で探す
  let role = guild.roles.cache.find((r) => r.name === roleName);

  // ② 無ければ作る
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      mentionable: false,
      hoist: false,
      permissions: [], // 権限は空（安全）
      reason: "診断結果ロールを自動作成",
    });
    await guild.roles.fetch(); // キャッシュ更新
  }

  // ③ 階層チェック
  const botHighest = me.roles.highest;
  if (botHighest.comparePositionTo(role) <= 0) {
    await respond(
      `ロール「${roleName}」を付与できない…\n` +
        `原因：Botのロールが付与対象ロールより下にある可能性が高いよ。\n` +
        `サーバー設定 → ロール で Botロールを上に移動してね！`
    );
    return;
  }

  // ④ 1人1つ運用なら他の診断ロールを外す（36種だけ）
  if (SINGLE_ROLE_MODE) {
    const removeTargets = member.roles.cache.filter(
      (r) => ALL_RESULT_NAMES.includes(r.name) && r.id !== role.id
    );
    if (removeTargets.size > 0) {
      await member.roles.remove(removeTargets);
    }
  }

  // ⑤ 付与
  await member.roles.add(role);
  await respond(`✅ 登録OK！ → **${roleName}**（ロール付与済み）`);
}

async function resetShindanRoles(interaction) {
  const respond = makeResponder(interaction);
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await respond("ギルド/メンバー情報が取れなかった…");
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await respond("Botに「ロール管理（Manage Roles）」権限がないみたい。サーバー側で付けてね！");
    return;
  }

  // 診断結果36種「と同名のロール」だけ外す（それ以外は触らない）
  const removeTargets = member.roles.cache.filter((r) =>
    ALL_RESULT_NAMES.includes(r.name)
  );

  if (removeTargets.size === 0) {
    await respond("いま診断ロールが付いていないみたい！そのまま結果を選んでOK");
    return;
  }

  await member.roles.remove(removeTargets);
  await respond("✅ 診断ロールをリセットしました！もう一度選び直してね");
}

// 常設ランチャーを設置（重複投稿しない）
async function ensureLauncherMessage(c) {
  const channel = await c.channels.fetch(TARGET_CHANNEL_ID);
  if (!channel) return;

  // 既に置いてあれば増やさない（直近20件をチェック）
  const messages = await channel.messages.fetch({ limit: 20 });
  const alreadyExists = messages.some(
    (m) =>
      m.author.id === c.user.id &&
      m.components?.some((row) =>
        row.components?.some(
          (comp) => comp.customId === OPEN_SHINDANROLE_BTN_ID
        )
      )
  );

  if (alreadyExists) {
    console.log("ℹ️ 診断ランチャーは既に設置済み");
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_SHINDANROLE_BTN_ID)
      .setLabel("診断結果を選ぶ")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content:
      "👇 診断結果の登録はこちら\n" +
      "（ボタンを押すと、診断結果の選択画面が開きます）",
    components: [row],
  });

  console.log("✅ 診断ランチャーをチャンネルに設置しました");
}

// =====================
// 起動
// =====================
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await registerCommands();
  await ensureLauncherMessage(c);
});

// =====================
// 受け付け
// =====================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --------- スラッシュコマンド ----------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "shindanrole") {
        if (!(await ensureTargetChannel(interaction))) return;

        const { selectRows, resetRow } = buildShindanroleUI();
        await interaction.reply({
          content:
            "あなたの診断結果を、該当タイプのプルダウンから選んでください👇\n" +
            "（間違えたら下の「診断ロールをリセット」ボタンでやり直せます）",
          components: [...selectRows, resetRow],
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "shindanrole_reset") {
        if (!(await ensureTargetChannel(interaction))) return;
        await resetShindanRoles(interaction);
        return;
      }

      return;
    }

    // --------- セレクトメニュー ----------
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("shindanrole_cat_")) return;
      if (!(await ensureTargetChannel(interaction))) return;

      const selected = interaction.values[0];

      // UIを閉じる（分かりやすい）
      await interaction.update({
        content: `処理中…（${selected}）`,
        components: [],
      });

      await applyRoleByName(interaction, selected);
      return;
    }

    // --------- ボタン ----------
    if (interaction.isButton()) {
      // 常設の「診断をはじめる」
      if (interaction.customId === OPEN_SHINDANROLE_BTN_ID) {
        if (!(await ensureTargetChannel(interaction))) return;

        const { selectRows, resetRow } = buildShindanroleUI();
        await interaction.reply({
          content:
            "あなたの診断結果を、該当タイプのプルダウンから選んでください👇\n" +
            "（選び間違えた場合は、プルダウン下の「診断ロールをリセット」ボタンでロールをリセットしてからやり直せます）",
          components: [...selectRows, resetRow],
          ephemeral: true,
        });
        return;
      }

      // ephemeral内の「診断ロールをリセット」
      if (interaction.customId === RESET_BTN_ID) {
        if (!(await ensureTargetChannel(interaction))) return;

        // UIを閉じてからリセット（見やすい）
        await interaction.update({
          content: "リセット処理中…",
          components: [],
        });

        await resetShindanRoles(interaction);
        return;
      }
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      const msg =
        "エラーが出た…（権限/ロール階層/チャンネルIDを確認してね）";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  }
});

// =====================
// ログイン
// =====================
client.login(process.env.DISCORD_TOKEN);

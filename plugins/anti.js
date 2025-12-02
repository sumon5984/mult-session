// plugin/antilink.js
import { Module } from '../lib/plugins.js';
import { groupDB } from '../lib/database/index.js';
import cache from '../lib/cache.js';

// Link detection patterns (broad)
const LINK_PATTERNS = [
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi,
  /chat\.whatsapp\.com\/[a-zA-Z0-9_-]+/gi,
  /wa\.me\/[0-9]+/gi,
  /whatsapp\.com\/channel\/[a-zA-Z0-9_-]+/gi,
  /t\.me\/[a-zA-Z0-9_]+/gi,
  /telegram\.me\/[a-zA-Z0-9_]+/gi,
  /discord\.gg\/[a-zA-Z0-9]+/gi,
  /instagram\.com\/[a-zA-Z0-9._]+/gi,
  /youtu\.be\/[a-zA-Z0-9_-]+/gi,
  /youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
  /bit\.ly\/[a-zA-Z0-9]+/gi,
  /(?:^|\s)([a-zA-Z0-9-]+\.(?:com|net|org|io|co|me|tv|gg|xyz|info|biz|online|site|club|top|pro|vip|app)(?:\/[^\s]*)?)/gi,
];

// extract unique links from text
function extractLinks(text) {
  if (!text) return [];
  const found = new Set();
  for (const p of LINK_PATTERNS) {
    const m = text.match(p);
    if (m) m.forEach((l) => found.add(l.trim()));
  }
  return Array.from(found);
}

// Helper: fast Redis-backed get/set with DB fallback (low memory, low CPU)
async function getGroupSetting(type, jid) {
  const key = `group:${jid}:${type}`;
  try {
    const cached = await cache.get(key);
    if (cached != null) {
      try { return JSON.parse(cached); } catch (e) { return cached; }
    }
  } catch (e) {}

  // Fallback to persistent DB
  try {
    const data = await groupDB([type], { jid }, 'get').catch(() => ({}));
    const val = data && data[type] ? data[type] : null;
    try { await cache.set(key, typeof val === 'string' ? val : JSON.stringify(val || {}), 300); } catch (e) {}
    return val;
  } catch (e) {
    return null;
  }
}

async function setGroupSetting(type, jid, content) {
  const key = `group:${jid}:${type}`;
  try {
    await groupDB([type], { jid, content }, 'set').catch(() => null);
  } catch (e) {}
  try { await cache.set(key, typeof content === 'string' ? content : JSON.stringify(content), 300); } catch (e) {}
  return true;
}

// unified violation handler: delete + warn/kick/null
async function handleViolationLinks(message, sender, settings, reason) {
  const jid = message.from;
  const conn = message.conn;

  // delete message
  try {
    await conn.sendMessage(jid, { delete: message.key });
  } catch (e) {
    console.error("❌ Failed to delete message:", e?.message || e);
  }

  const action = settings.action || "kick";
  const warns = settings.warns || {};
  const currentWarn = warns[sender] || 0;
  const maxWarn = typeof settings.warn_count === "number" ? settings.warn_count : parseInt(settings.warn_count) || 3;

  if (action === "null") return;

  if (action === "warn") {
    const newWarn = currentWarn + 1;
    warns[sender] = newWarn;
    try {
      await setGroupSetting('link', jid, { ...settings, warns });
    } catch (e) {
      console.error("❌ failed to persist warns:", e?.message || e);
    }

    if (newWarn >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, {
          text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`,
          mentions: [sender],
        });
        delete warns[sender];
        await setGroupSetting('link', jid, { ...settings, warns });
      } catch (e) {
        console.error("❌ Failed to remove user:", e?.message || e);
        await conn.sendMessage(jid, {
          text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin privileges.`,
          mentions: [sender],
        });
      }
    } else {
      await conn.sendMessage(jid, {
        text: `⚠️ @${sender.split("@")[0]}, sharing links is not allowed!\nWarning ${newWarn}/${maxWarn}`,
        mentions: [sender],
      });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, {
        text: `❌ @${sender.split("@")[0]} removed for sharing links.`,
        mentions: [sender],
      });
    } catch (e) {
      console.error("❌ Failed to remove user:", e?.message || e);
      await conn.sendMessage(jid, {
        text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin privileges.`,
        mentions: [sender],
      });
    }
  }
}

/**
 * Command interface: .antilink <subcommand|message>
 * Controls per-group settings stored in groupDB under ["link"]
 */
Module({
  command: "antilink",
  package: "group",
  description: "Manage anti-link settings (on/off/action/warn/not_del/reset/list)",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("This command works in groups only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");

  const raw = (match || "").trim();
  const lower = raw.toLowerCase();

  // fetch existing settings (safe defaults)
  const current = (await getGroupSetting('link', message.from)) || {
    status: "false",
    action: "null",
    not_del: [],
    warns: {},
    warn_count: 3,
  };
  if (!Array.isArray(current.not_del)) current.not_del = [];
  if (typeof current.warn_count !== "number") current.warn_count = parseInt(current.warn_count) || 3;

  // help / show
  if (!raw || lower === "help" || lower === "show") {
    return message.send?.(
      `*Antilink Settings*\n\n` +
      `• Status: ${current.status === "true" ? "✅ ON" : "❌ OFF"}\n` +
      `• Action: ${current.action}\n` +
      `• Warn before kick: ${current.warn_count}\n` +
      `• Ignore URLs: ${current.not_del.length ? current.not_del.join(", ") : "None"}\n\n` +
      `Commands:\n` +
      `.antilink on|off\n` +
      `.antilink action warn|kick|null\n` +
      `.antilink set_warn <number>\n` +
      `.antilink not_del <url>\n` +
      `.antilink remove_not_del <url>\n` +
      `.antilink list\n` +
      `.antilink reset`
    );
  }

  // reset
  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { status: "false", action: "null", not_del: [], warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antilink settings reset to default.");
  }

  // list not_del
  if (lower === "list") {
    const list = current.not_del.length ? current.not_del : ["(empty)"];
    return message.send?.(`📃 Ignored URLs:\n${list.map((u) => `• ${u}`).join("\n")}`);
  }

  // on/off
  if (lower === "on" || lower === "off") {
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, status: lower === "on" ? "true" : "false" });
    await message.react?.("✅");
    return message.send?.(`✅ Antilink ${lower === "on" ? "activated" : "deactivated"}.`);
  }

  // action <type>
  if (lower.startsWith("action")) {
    const arg = raw.replace(/action/i, "").trim().toLowerCase();
    const allowed = ["null", "warn", "kick"];
    if (!allowed.includes(arg)) {
      await message.react?.("❌");
      return message.send?.("Invalid action — use: `null`, `warn`, or `kick`.");
    }
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`⚙️ Antilink action set to *${arg}*`);
  }

  // set_warn <n>
  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i, "").trim());
    if (isNaN(n) || n < 1 || n > 20) {
      await message.react?.("❌");
      return message.send?.("Provide a valid number between 1 and 20.");
    }
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`🚨 Warn-before-kick set to ${n}`);
  }

  // not_del <url>
  if (lower.startsWith("not_del")) {
    const url = raw.replace(/not_del/i, "").trim();
    if (!url) {
      await message.react?.("❌");
      return message.send?.("Provide a URL to ignore (must start with http or domain).");
    }
    const list = current.not_del || [];
    if (list.some((l) => l.toLowerCase() === url.toLowerCase())) {
      await message.react?.("❌");
      return message.send?.("URL already in ignore list.");
    }
    list.push(url);
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, not_del: list });
    await message.react?.("✅");
    return message.send?.("✅ URL added to ignore list.");
  }

  // remove_not_del <url>
  if (lower.startsWith("remove_not_del")) {
    const url = raw.replace(/remove_not_del/i, "").trim();
    if (!url) {
      await message.react?.("❌");
      return message.send?.("Provide a URL to remove.");
    }
    const newList = (current.not_del || []).filter((l) => l.toLowerCase() !== url.toLowerCase());
    if (newList.length === (current.not_del || []).length) {
      await message.react?.("❌");
      return message.send?.("URL not found in ignore list.");
    }
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, not_del: newList });
    await message.react?.("✅");
    return message.send?.("✅ URL removed from ignore list.");
  }

  // unknown
  await message.react?.("❌");
  return message.send?.("Invalid usage. Send `.antilink` for help.");
});

/**
 * Auto-check every text message
 * This is the enforcement runner — it reads per-group settings and acts accordingly.
 */
Module({ on: "text" })(async (message) => {
  try {
    if (!message.isGroup) return;
    if (message.isFromMe) return;
    if (message.isAdmin) return;

    // message text could be body or caption etc.
    const text = (message.body || message.caption || "").toString().trim();
    if (!text) return;

    // read group settings (fast Redis-backed)
    const settings = (await getGroupSetting('link', message.from)) || { status: "false", action: "null", not_del: [], warns: {}, warn_count: 3 };
    if (settings.status !== "true") return;

    // detect links
    const links = extractLinks(text);
    if (!links.length) return;

    // filter by whitelist
    const whitelist = settings.not_del || [];
    const filtered = links.filter((l) => !whitelist.some((w) => l.toLowerCase().includes(w.toLowerCase())));
    if (!filtered.length) return;

    // handle violation for the first offending link
            await handleViolationLinks(message, message.sender, settings, `sharing links: ${filtered[0]}`);
  } catch (err) {
    console.error("❌ antilink auto handler error:", err);
  }
});



const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bstory\b/i,
  /whatsapp\.com\/status/gi,
  /wa\.me\/status/gi,
  /\bviewed my status\b/i
];

function hasStatusMention(text) {
  if (!text) return false;
  for (const p of STATUS_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

async function handleViolationStatus(message, sender, settings, reason) {
  const jid = message.from;
  const conn = message.conn;
  try { await conn.sendMessage(jid, { delete: message.key }); } catch (e) {}
  const action = settings.action || "null";
  const warns = settings.warns || {};
  const current = warns[sender] || 0;
  const maxWarn = settings.warn_count || 3;

  if (action === "null") return;

  if (action === "warn") {
    const nw = current + 1;
    warns[sender] = nw;
    await setGroupSetting('status', jid, { ...settings, warns });
    if (nw >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`, mentions: [sender] });
        delete warns[sender];
        await setGroupSetting('status', jid, { ...settings, warns });
      } catch (e) {
        await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
      }
    } else {
      await conn.sendMessage(jid, { text: `⚠️ @${sender.split("@")[0]}, posting status invites/mentions is not allowed.\nWarning ${nw}/${maxWarn}`, mentions: [sender] });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed for posting status invites.`, mentions: [sender] });
    } catch (e) {
      await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
    }
  }
}

// ---------------- Command ----------------
Module({
  command: "antistatus",
  package: "group",
  description: "Block status posting/mentions in group",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("Group only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");
  const raw = (match||"").trim();
  const lower = raw.toLowerCase();

  const current = (await getGroupSetting('status', message.from)) || { status: "false", action: "null", warns: {}, warn_count: 3 };

  if (!raw) {
    return message.send?.(
      `*Antistatus Settings*\n\n`+
      `• Status: ${current.status==="true"?"✅ ON":"❌ OFF"}\n`+
      `• Action: ${current.action}\n`+
      `• Warn before kick: ${current.warn_count}\n\n`+
      `Commands:\n`+
      `.antistatus on|off\n`+
      `.antistatus action warn|kick|null\n`+
      `.antistatus set_warn <n>\n`+
      `.antistatus reset`
    );
  }

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { status: "false", action: "null", warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antistatus reset.");
  }

  if (lower === "on" || lower === "off") {
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { ...current, status: lower === "on" ? "true" : "false" });
    await message.react?.("✅");
    return message.send?.(`✅ Antistatus ${lower === "on" ? "activated" : "deactivated"}.`);
  }

  if (lower.startsWith("action")) {
    const arg = raw.replace(/action/i, "").trim().toLowerCase();
    if (!["null","warn","kick"].includes(arg)) { await message.react?.("❌"); return message.send?.("Invalid action"); }
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`Action set to ${arg}`);
  }

  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i, "").trim());
    if (isNaN(n)||n<1||n>20) { await message.react?.("❌"); return message.send?.("Invalid number"); }
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`Warn count set to ${n}`);
  }

  await message.react?.("❌");
  return message.send?.("Invalid usage. Use .antistatus for help.");
});

// ---------------- Enforcement ----------------
Module({ on: "text" })(async (message) => {
  try {
    if (!message.isGroup) return;
    if (message.isFromMe) return;
    if (message.isAdmin) return;

    const settings = (await getGroupSetting('status', message.from)) || { status: "false", action: "null", warns: {}, warn_count: 3 };
    if (settings.status !== "true") return;

    const text = (message.body || message.caption || "").toString().trim();

    // Check text-based detection
    if (hasStatusMention(text)) {
      return await handleViolationStatus(message, message.sender, settings, "status mention");
    }

    // Check real WhatsApp mention in contextInfo
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    if (mentioned.includes("status@broadcast")) {
      return await handleViolationStatus(message, message.sender, settings, "mentioning status");
    }

  } catch (e) {
    console.error("❌ antistatus handler error:", e);
  }
});



function looksLikeBot(message) {
  try {
    const pushName = (message.pushName || message.notify || "").toLowerCase();
    const jid = (message.sender || "").toLowerCase();
    if (pushName.includes("bot")) return true;
    if (jid.includes("bot")) return true;
    // forwarded check if available
    const ctx = message.message?.contextInfo || {};
    if (ctx.isForwarded) return true;
    if (typeof message.forwardedScore === "number" && message.forwardedScore > 10) return true;
  } catch (e) {}
  return false;
}

async function handleViolationBot(message, sender, settings, reason) {
  const jid = message.from;
  const conn = message.conn;
  try { await conn.sendMessage(jid, { delete: message.key }); } catch (e) {}

  const action = settings.action || "null";
  const warns = settings.warns || {};
  const cur = warns[sender] || 0;
  const maxWarn = settings.warn_count || 3;

  if (action === "null") return;

  if (action === "warn") {
    const newWarn = cur + 1;
    warns[sender] = newWarn;
    await setGroupSetting('bot', jid, { ...settings, warns });
    if (newWarn >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`, mentions: [sender] });
        delete warns[sender];
        await setGroupSetting('bot', jid, { ...settings, warns });
      } catch (e) {
        await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
      }
    } else {
      await conn.sendMessage(jid, { text: `⚠️ @${sender.split("@")[0]}, bot accounts are not allowed!\nWarning ${newWarn}/${maxWarn}`, mentions: [sender] });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed for suspected bot account.`, mentions: [sender] });
    } catch (e) {
      await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
    }
  }
}

// ---------------- Command ----------------
Module({
  command: "antibot",
  package: "group",
  description: "Block/handle bot accounts (heuristics)",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("Group only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");
  const raw = (match||"").trim();
  const lower = raw.toLowerCase();

  const current = (await getGroupSetting('bot', message.from)) || { status: "false", action: "null", warns: {}, warn_count: 3 };
  
  if (!raw) {
    return message.send?.(
      `*Antibot Settings*\n\n`+
      `• Status: ${current.status==="true"?"✅ ON":"❌ OFF"}\n`+
      `• Action: ${current.action}\n`+
      `• Warn before kick: ${current.warn_count}\n\n`+
      `Commands:\n`+
      `.antibot on|off\n`+
      `.antibot action warn|kick|null\n`+
      `.antibot set_warn <n>\n`+
      `.antibot reset`
    );
  }

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { status: "false", action: "null", warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antibot reset.");
  }

  if (lower === "on" || lower === "off") {
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { ...current, status: lower === "on" ? "true" : "false" });
    await message.react?.("✅");
    return message.send?.(`✅ Antibot ${lower === "on" ? "activated" : "deactivated"}.`);
  }

  if (lower.startsWith("action")) {
    const arg = raw.replace(/action/i,"").trim().toLowerCase();
    if (!["null","warn","kick"].includes(arg)) { await message.react?.("❌"); return message.send?.("Invalid action"); }
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`Action set to ${arg}`);
  }

  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i,"").trim());
    if (isNaN(n)||n<1||n>20) { await message.react?.("❌"); return message.send?.("Invalid number"); }
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`Warn count set to ${n}`);
  }

  await message.react?.("❌");
  return message.send?.("Invalid usage. Use .antibot for help.");
});

// ---------------- Enforcement ----------------
Module({ on: "text" })(async (message) => {
  try {
    if (!message.isGroup) return;
    if (message.isFromMe) return;
    if (message.isAdmin) return;

    const settings = (await getGroupSetting('bot', message.from)) || { status: "false", action: "null", warns: {}, warn_count: 3 };
    if (settings.status !== "true") return;

    if (looksLikeBot(message)) {
    await handleViolationBot(message, message.sender, settings, "suspected bot account");
    }
  } catch (e) {
    console.error("❌ antibot handler error:", e);
  }
});


async function handleViolationTagall(message, sender, settings, reason) {
  const jid = message.from;
  const conn = message.conn;
  const deleteMsg = async () => { try { await conn.sendMessage(jid, { delete: message.key }); } catch (e) {} };

  await deleteMsg();

  const action = settings.action || "null";
  const warns = settings.warns || {};
  const cur = warns[sender] || 0;
  const maxWarn = settings.warn_count || 3;

  if (action === "null") return;

  if (action === "warn") {
    const newWarn = cur + 1;
    warns[sender] = newWarn;
    await setGroupSetting('tagall', jid, { ...settings, warns });
    if (newWarn >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`, mentions: [sender] });
        delete warns[sender];
        await setGroupSetting('tagall', jid, { ...settings, warns });
      } catch (e) {
        await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
      }
    } else {
      await conn.sendMessage(jid, { text: `⚠️ @${sender.split("@")[0]}, mass mention is not allowed!\nWarning ${newWarn}/${maxWarn}`, mentions: [sender] });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, { text: `❌ @${sender.split("@")[0]} removed for mass tagging.`, mentions: [sender] });
    } catch (e) {
      await conn.sendMessage(jid, { text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin.`, mentions: [sender] });
    }
  }
}


const defaultWords = [
  "sex","porn","xxx","xvideo","cum4k","randi","chuda","fuck","nude","bobs","vagina"
];

function findBanned(text, list) {
  if (!text) return null;
  const lowered = text.toLowerCase();
  for (const w of list) {
    if (!w) continue;
    // simple substring match (you can make this regex-based if needed)
    if (lowered.includes(w.toLowerCase())) return w;
  }
  return null;
}

async function handleViolationWord(message, sender, settings, reason) {
  const jid = message.from;
  const conn = message.conn;
  const deleteMsg = async () => {
    try { await conn.sendMessage(jid, { delete: message.key }); } catch (e) { }
  };

  // always delete
  await deleteMsg();

  const action = settings.action || "null";
  const warns = settings.warns || {};
  const currentWarn = warns[sender] || 0;
  const maxWarn = settings.warn_count || 3;

  if (action === "null") return;

  if (action === "warn") {
    const newWarn = currentWarn + 1;
    warns[sender] = newWarn;
    await setGroupSetting('word', jid, { ...settings, warns });
    if (newWarn >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, {
          text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`,
          mentions: [sender],
        });
        delete warns[sender];
        await setGroupSetting('word', jid, { ...settings, warns });
      } catch (e) {
        await conn.sendMessage(jid, {
          text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin privileges.`,
          mentions: [sender],
        });
      }
    } else {
      await conn.sendMessage(jid, {
        text: `⚠️ @${sender.split("@")[0]}, using banned words is not allowed!\nWarning ${newWarn}/${maxWarn}`,
        mentions: [sender],
      });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, {
        text: `❌ @${sender.split("@")[0]} removed for using banned words.`,
        mentions: [sender],
      });
    } catch (e) {
      await conn.sendMessage(jid, {
        text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin privileges.`,
        mentions: [sender],
      });
    }
  }
}

// ---------------- Command ----------------
Module({
  command: "antiword",
  package: "group",
  description: "Manage antiword settings",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("This command works in groups only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");
  const raw = (match || "").trim();
  const lower = raw.toLowerCase();

  const current = (await getGroupSetting('word', message.from)) || { status: "false", action: "null", words: [], warns: {}, warn_count: 3 };
  if (!Array.isArray(current.words)) current.words = [];

  if (!raw) {
    return message.send?.(
      `*Antiword Settings*\n\n` +
      `• Status: ${current.status === "true" ? "✅ ON" : "❌ OFF"}\n` +
      `• Action: ${current.action}\n` +
      `• Warn before kick: ${current.warn_count}\n` +
      `• Words: ${current.words.length ? current.words.join(", ") : defaultWords.join(", ")}\n\n` +
      `Commands:\n` +
      `.antiword on|off\n` +
      `.antiword action warn|kick|null\n` +
      `.antiword set_warn <n>\n` +
      `.antiword add <word>\n` +
      `.antiword remove <word>\n` +
      `.antiword list\n` +
      `.antiword reset`
    );
  }

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('word', message.from, { status: "false", action: "null", words: [], warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antiword settings reset.");
  }

  if (lower === "list") {
    const list = current.words.length ? current.words : defaultWords;
    return message.send?.(`📃 Banned words:\n${list.map(w => `• ${w}`).join("\n")}`);
  }

  if (lower === "on" || lower === "off") {
    await message.react?.("⏳");
    await setGroupSetting('word', message.from, { ...current, status: lower === "on" ? "true" : "false" });
    await message.react?.("✅");
    return message.send?.(`✅ Antiword ${lower === "on" ? "activated" : "deactivated"}.`);
  }

  if (lower.startsWith("action")) {
    const arg = raw.replace(/action/i, "").trim().toLowerCase();
    const allowed = ["null","warn","kick"];
    if (!allowed.includes(arg)) {
      await message.react?.("❌");
      return message.send?.("Invalid action. Use: null, warn, kick");
    }
    await message.react?.("⏳");
    await setGroupSetting('word', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`⚙️ Action set to ${arg}`);
  }

  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i, "").trim());
    if (isNaN(n) || n < 1 || n > 20) {
      await message.react?.("❌");
      return message.send?.("Provide valid number 1-20");
    }
    await message.react?.("⏳");
    await setGroupSetting('word', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`Warn count set to ${n}`);
  }

  if (lower.startsWith("add")) {
    const word = raw.replace(/add/i,"").trim().toLowerCase();
    if (!word || word.includes(" ")) {
      await message.react?.("❌");
      return message.send?.("Provide a single word to add");
    }
    if (current.words.includes(word)) {
      await message.react?.("❌");
      return message.send?.("Word already in list");
    }
    current.words.push(word);
    await setGroupSetting('word', message.from, { ...current });
    await message.react?.("✅");
    return message.send?.(`✅ Word "${word}" added`);
  }

  if (lower.startsWith("remove")) {
    const word = raw.replace(/remove/i,"").trim().toLowerCase();
    const newWords = current.words.filter(w => w !== word);
    if (newWords.length === current.words.length) {
      await message.react?.("❌");
      return message.send?.("Word not found");
    }
    await setGroupSetting('word', message.from, { ...current, words: newWords });
    await message.react?.("✅");
    return message.send?.(`🗑️ Word "${word}" removed`);
  }

  await message.react?.("❌");
  return message.send?.("Invalid usage. Use .antiword for help.");
});

// ---------------- Enforcement (text) ----------------
Module({ on: "text" })(async (message) => {
  try {
    if (!message.isGroup) return;
    if (message.isFromMe) return;
    if (message.isAdmin) return;
    const text = (message.body || message.caption || "").toString();
    if (!text) return;

    const settings = (await getGroupSetting('word', message.from)) || { status: "false", action: "null", words: [], warns: {}, warn_count: 3 };
    if (settings.status !== "true") return;

    const list = Array.isArray(settings.words) && settings.words.length ? settings.words : defaultWords;
    const found = findBanned(text, list);
    if (!found) return;

    await handleViolationWord(message, message.sender, settings, `using banned word: ${found}`);
  } catch (err) {
    console.error("❌ antiword handler error:", err);
  }
});
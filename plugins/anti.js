// plugin/anti.js - Unified Anti-Spam Module
import { Module } from '../lib/plugins.js';
import { groupDB } from '../lib/database/index.js';
import cache from '../lib/cache.js';

// ============= DETECTION PATTERNS =============
const LINK_PATTERNS = [
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/gi,
  /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/[a-zA-Z0-9_-]+/gi,
  /(?:https?:\/\/)?wa\.me\/\d+/gi,
  /(?:https?:\/\/)?whatsapp\.com\/channel\/[a-zA-Z0-9_-]+/gi,
  /(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]+/gi,
  /(?:https?:\/\/)?telegram\.me\/[a-zA-Z0-9_]+/gi,
  /(?:https?:\/\/)?discord\.gg\/[a-zA-Z0-9]+/gi,
  /(?:https?:\/\/)?instagram\.com\/[a-zA-Z0-9._]+/gi,
  /(?:https?:\/\/)?youtu\.be\/[a-zA-Z0-9_-]+/gi,
  /(?:https?:\/\/)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
  /(?:https?:\/\/)?bit\.ly\/[a-zA-Z0-9]+/gi,
  /(?:https?:\/\/)?tinyurl\.com\/[a-zA-Z0-9]+/gi,
  /\b[a-zA-Z0-9-]+\.(?:com|net|org|io|co|me|tv|gg|xyz|info|biz|online|site|club|top|pro|vip|app|dev|ai|tech)\b/gi,
];

const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bstory\b/i,
  /whatsapp\.com\/status/gi,
  /wa\.me\/status/gi,
  /\bviewed my status\b/i,
  /\bview my status\b/i,
  /status@broadcast/i,
];

const DEFAULT_BADWORDS = [
  "sex", "porn", "xxx", "xvideo", "cum4k", "randi", "chuda", "fuck", "nude", "bobs", "vagina",
  "pussy", "dick", "ass", "slut", "bitch", "porno", "horny"
];

// ============= DETECTION FUNCTIONS =============
function extractLinks(text) {
  if (!text) return [];
  const found = new Set();
  for (const p of LINK_PATTERNS) {
    const m = text.match(p);
    if (m) m.forEach((l) => found.add(l.toLowerCase().trim()));
  }
  return Array.from(found);
}

function findBannedWord(text, list) {
  if (!text) return null;
  const lowered = text.toLowerCase();
  for (const w of list) {
    if (!w) continue;
    const regex = new RegExp(`\\b${w}\\b`, 'i');
    if (regex.test(lowered)) return w;
  }
  return null;
}

function hasStatusMention(text) {
  if (!text) return false;
  for (const p of STATUS_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

function looksLikeBot(message) {
  try {
    const pushName = (message.pushName || message.notify || "").toLowerCase();
    const jid = (message.sender || "").toLowerCase();
    
    if (pushName.includes("bot") || pushName.endsWith("bot")) return true;
    if (jid.includes("bot")) return true;
    if (pushName.includes("official") || pushName.includes("channel")) return true;
    
    const ctx = message.message?.contextInfo || {};
    if (ctx.isForwarded) return true;
    if (typeof message.forwardedScore === "number" && message.forwardedScore > 10) return true;
  } catch (e) { }
  return false;
}

function detectTagAll(message) {
  try {
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    return mentioned && mentioned.length > 20;
  } catch (e) { }
  return false;
}

// ============= CACHE & DATABASE =============
async function getGroupSetting(type, jid) {
  const key = `group:${jid}:${type}`;
  try {
    const cached = await cache.get(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      } catch (e) { }
    }
  } catch (e) { console.error(`[CACHE] Error reading ${type}:`, e?.message); }

  try {
    const data = await groupDB([type], { jid }, 'get').catch(() => ({}));
    let val = data && data[type] ? data[type] : null;
    
    // Ensure we return an object, not a string
    if (val && typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch (e) {
        console.warn(`[DB] Value for ${type} is string, converting to object`);
        val = null;
      }
    }
    
    try { await cache.set(key, JSON.stringify(val || {}), 300); } catch (e) { }
    return val;
  } catch (e) {
    console.error(`[DB] Error reading ${type}:`, e?.message);
    return null;
  }
}

async function setGroupSetting(type, jid, content) {
  const key = `group:${jid}:${type}`;
  try {
    await groupDB([type], { jid, content }, 'set').catch(() => null);
  } catch (e) { console.error(`[DB] Error writing ${type}:`, e?.message); }
  try { 
    await cache.set(key, JSON.stringify(content), 300);
  } catch (e) { console.error(`[CACHE] Error setting ${type}:`, e?.message); }
  return true;
}

// ============= UNIFIED VIOLATION HANDLER =============
async function handleViolation(message, sender, violationType, settings, reason) {
  const jid = message.from;
  const conn = message.conn;

  // Delete message
  try {
    await conn.sendMessage(jid, { delete: message.key });
  } catch (e) {
    console.error(`[${violationType}] Delete failed:`, e?.message);
  }

  const action = settings.action || "kick";
  const warns = settings.warns || {};
  const currentWarn = warns[sender] || 0;
  const maxWarn = typeof settings.warn_count === "number" ? settings.warn_count : parseInt(settings.warn_count) || 3;

  if (action === "null") return;

  if (action === "warn") {
    const newWarn = currentWarn + 1;
    warns[sender] = newWarn;
    await setGroupSetting(violationType, jid, { ...settings, warns });

    if (newWarn >= maxWarn) {
      try {
        await message.removeParticipant([sender]);
        await conn.sendMessage(jid, {
          text: `❌ @${sender.split("@")[0]} removed after ${maxWarn} warnings for ${reason}.`,
          mentions: [sender],
        });
        delete warns[sender];
        await setGroupSetting(violationType, jid, { ...settings, warns });
      } catch (e) {
        await conn.sendMessage(jid, {
          text: `⚠️ Cannot remove @${sender.split("@")[0]}. Bot needs admin privileges.`,
          mentions: [sender],
        });
      }
    } else {
      await conn.sendMessage(jid, {
        text: `⚠️ @${sender.split("@")[0]}, ${reason}\nWarning ${newWarn}/${maxWarn}`,
        mentions: [sender],
      });
    }
    return;
  }

  if (action === "kick") {
    try {
      await message.removeParticipant([sender]);
      await conn.sendMessage(jid, {
        text: `❌ @${sender.split("@")[0]} removed for ${reason}.`,
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

// ============= COMMANDS =============

// ANTILINK COMMAND
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

  let current = (await getGroupSetting('link', message.from)) || {};
  
  // Ensure current is an object, not a string
  if (typeof current === 'string') current = {};
  
  // Set defaults for missing properties
  if (!current.status) current.status = "false";
  if (!current.action) current.action = "kick";
  if (!Array.isArray(current.not_del)) current.not_del = [];
  if (!current.warns) current.warns = {};
  if (typeof current.warn_count !== "number") current.warn_count = parseInt(current.warn_count) || 3;

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

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { status: "false", action: "kick", not_del: [], warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antilink settings reset to default.");
  }

  if (lower === "list") {
    const list = current.not_del.length ? current.not_del : ["(empty)"];
    return message.send?.(`📃 Ignored URLs:\n${list.map((u) => `• ${u}`).join("\n")}`);
  }

  if (lower === "on" || lower === "off") {
    await message.react?.("⏳");
    await setGroupSetting('link', message.from, { ...current, status: lower === "on" ? "true" : "false" });
    await message.react?.("✅");
    return message.send?.(`✅ Antilink ${lower === "on" ? "activated" : "deactivated"}.`);
  }

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

  await message.react?.("❌");
  return message.send?.("Invalid usage. Send `.antilink` for help.");
});

// ANTISTATUS COMMAND
Module({
  command: "antistatus",
  package: "group",
  description: "Block status posting/mentions in group",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("Group only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");
  const raw = (match || "").trim();
  const lower = raw.toLowerCase();

  let current = (await getGroupSetting('status', message.from)) || {};
  if (typeof current === 'string') current = {};
  if (!current.status) current.status = "false";
  if (!current.action) current.action = "kick";
  if (!current.warns) current.warns = {};
  if (typeof current.warn_count !== "number") current.warn_count = parseInt(current.warn_count) || 3;

  if (!raw) {
    return message.send?.(
      `*Antistatus Settings*\n\n` +
      `• Status: ${current.status === "true" ? "✅ ON" : "❌ OFF"}\n` +
      `• Action: ${current.action}\n` +
      `• Warn before kick: ${current.warn_count}\n\n` +
      `Commands:\n` +
      `.antistatus on|off\n` +
      `.antistatus action warn|kick|null\n` +
      `.antistatus set_warn <n>\n` +
      `.antistatus reset`
    );
  }

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { status: "false", action: "kick", warns: {}, warn_count: 3 });
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
    if (!["null", "warn", "kick"].includes(arg)) {
      await message.react?.("❌");
      return message.send?.("Invalid action");
    }
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`Action set to ${arg}`);
  }

  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i, "").trim());
    if (isNaN(n) || n < 1 || n > 20) {
      await message.react?.("❌");
      return message.send?.("Invalid number");
    }
    await message.react?.("⏳");
    await setGroupSetting('status', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`Warn count set to ${n}`);
  }

  await message.react?.("❌");
  return message.send?.("Invalid usage. Use .antistatus for help.");
});

// ANTIBOT COMMAND
Module({
  command: "antibot",
  package: "group",
  description: "Block/handle bot accounts (heuristics)",
})(async (message, match) => {
  await message.loadGroupInfo?.();
  if (!message.isGroup) return message.send?.("Group only.");
  if (!message.isAdmin && !message.isFromMe) return message.send?.("Admin only.");
  const raw = (match || "").trim();
  const lower = raw.toLowerCase();

  let current = (await getGroupSetting('bot', message.from)) || {};
  if (typeof current === 'string') current = {};
  if (!current.status) current.status = "false";
  if (!current.action) current.action = "kick";
  if (!current.warns) current.warns = {};
  if (typeof current.warn_count !== "number") current.warn_count = parseInt(current.warn_count) || 3;

  if (!raw) {
    return message.send?.(
      `*Antibot Settings*\n\n` +
      `• Status: ${current.status === "true" ? "✅ ON" : "❌ OFF"}\n` +
      `• Action: ${current.action}\n` +
      `• Warn before kick: ${current.warn_count}\n\n` +
      `Commands:\n` +
      `.antibot on|off\n` +
      `.antibot action warn|kick|null\n` +
      `.antibot set_warn <n>\n` +
      `.antibot reset`
    );
  }

  if (lower === "reset") {
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { status: "false", action: "kick", warns: {}, warn_count: 3 });
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
    const arg = raw.replace(/action/i, "").trim().toLowerCase();
    if (!["null", "warn", "kick"].includes(arg)) {
      await message.react?.("❌");
      return message.send?.("Invalid action");
    }
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { ...current, action: arg });
    await message.react?.("✅");
    return message.send?.(`Action set to ${arg}`);
  }

  if (lower.startsWith("set_warn")) {
    const n = parseInt(raw.replace(/set_warn/i, "").trim());
    if (isNaN(n) || n < 1 || n > 20) {
      await message.react?.("❌");
      return message.send?.("Invalid number");
    }
    await message.react?.("⏳");
    await setGroupSetting('bot', message.from, { ...current, warn_count: n });
    await message.react?.("✅");
    return message.send?.(`Warn count set to ${n}`);
  }

  await message.react?.("❌");
  return message.send?.("Invalid usage. Use .antibot for help.");
});

// ANTIWORD COMMAND
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

  let current = (await getGroupSetting('word', message.from)) || {};
  if (typeof current === 'string') current = {};
  if (!current.status) current.status = "false";
  if (!current.action) current.action = "kick";
  if (!Array.isArray(current.words)) current.words = [];
  if (!current.warns) current.warns = {};
  if (typeof current.warn_count !== "number") current.warn_count = parseInt(current.warn_count) || 3;

  if (!raw) {
    return message.send?.(
      `*Antiword Settings*\n\n` +
      `• Status: ${current.status === "true" ? "✅ ON" : "❌ OFF"}\n` +
      `• Action: ${current.action}\n` +
      `• Warn before kick: ${current.warn_count}\n` +
      `• Words: ${current.words.length ? current.words.join(", ") : DEFAULT_BADWORDS.join(", ")}\n\n` +
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
    await setGroupSetting('word', message.from, { status: "false", action: "kick", words: [], warns: {}, warn_count: 3 });
    await message.react?.("✅");
    return message.send?.("♻️ Antiword settings reset.");
  }

  if (lower === "list") {
    const list = current.words.length ? current.words : DEFAULT_BADWORDS;
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
    const allowed = ["null", "warn", "kick"];
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
    const word = raw.replace(/add/i, "").trim().toLowerCase();
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
    const word = raw.replace(/remove/i, "").trim().toLowerCase();
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

// ============= UNIFIED TEXT HANDLER (SUPER FAST) =============
Module({ on: "text" })(async (message) => {
  try {
    if (!message.isGroup) return;
    if (message.isFromMe) return;
    if (message.isAdmin) return;

    const jid = message.from;
    const sender = message.sender;
    const text = (message.body || message.caption || "").toString().trim();

    if (!text) return;

    // ===== CHECK LINK =====
    let linkSettings = (await getGroupSetting('link', jid)) || {};
    if (typeof linkSettings === 'string') linkSettings = {};
    if (!linkSettings.status) linkSettings.status = "false";
    if (!linkSettings.action) linkSettings.action = "kick";
    if (!Array.isArray(linkSettings.not_del)) linkSettings.not_del = [];
    if (!linkSettings.warns) linkSettings.warns = {};
    if (typeof linkSettings.warn_count !== "number") linkSettings.warn_count = 3;
    
    if (linkSettings.status === "true") {
      const links = extractLinks(text);
      if (links.length) {
        const whitelist = linkSettings.not_del || [];
        const filtered = links.filter((l) => !whitelist.some((w) => l.toLowerCase().includes(w.toLowerCase())));
        if (filtered.length) {
          await handleViolation(message, sender, 'link', linkSettings, `sharing link`);
          return;
        }
      }
    }

    // ===== CHECK BAD WORDS =====
    let wordSettings = (await getGroupSetting('word', jid)) || {};
    if (typeof wordSettings === 'string') wordSettings = {};
    if (!wordSettings.status) wordSettings.status = "false";
    if (!wordSettings.action) wordSettings.action = "kick";
    if (!Array.isArray(wordSettings.words)) wordSettings.words = [];
    if (!wordSettings.warns) wordSettings.warns = {};
    if (typeof wordSettings.warn_count !== "number") wordSettings.warn_count = 3;
    
    if (wordSettings.status === "true") {
      const list = Array.isArray(wordSettings.words) && wordSettings.words.length ? wordSettings.words : DEFAULT_BADWORDS;
      const found = findBannedWord(text, list);
      if (found) {
        await handleViolation(message, sender, 'word', wordSettings, `using banned word`);
        return;
      }
    }

    // ===== CHECK STATUS MENTION =====
    let statusSettings = (await getGroupSetting('status', jid)) || {};
    if (typeof statusSettings === 'string') statusSettings = {};
    if (!statusSettings.status) statusSettings.status = "false";
    if (!statusSettings.action) statusSettings.action = "kick";
    if (!statusSettings.warns) statusSettings.warns = {};
    if (typeof statusSettings.warn_count !== "number") statusSettings.warn_count = 3;
    
    if (statusSettings.status === "true") {
      if (hasStatusMention(text)) {
        await handleViolation(message, sender, 'status', statusSettings, "status mention/invite");
        return;
      }

      const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentioned.includes("status@broadcast")) {
        await handleViolation(message, sender, 'status', statusSettings, "mentioning status");
        return;
      }
    }

    // ===== CHECK BOT =====
    let botSettings = (await getGroupSetting('bot', jid)) || {};
    if (typeof botSettings === 'string') botSettings = {};
    if (!botSettings.status) botSettings.status = "false";
    if (!botSettings.action) botSettings.action = "kick";
    if (!botSettings.warns) botSettings.warns = {};
    if (typeof botSettings.warn_count !== "number") botSettings.warn_count = 3;
    
    if (botSettings.status === "true") {
      if (looksLikeBot(message)) {
        await handleViolation(message, sender, 'bot', botSettings, "bot account");
        return;
      }
    }

   /*// ===== CHECK TAG ALL =====
    let tagallSettings = (await getGroupSetting('tagall', jid)) || {};
    if (typeof tagallSettings === 'string') tagallSettings = {};
    if (!tagallSettings.status) tagallSettings.status = "false";
    if (!tagallSettings.action) tagallSettings.action = "kick";
    if (!tagallSettings.warns) tagallSettings.warns = {};
    if (typeof tagallSettings.warn_count !== "number") tagallSettings.warn_count = 3;
    
    if (tagallSettings.status === "true") {
      if (detectTagAll(message)) {
        await handleViolation(message, sender, 'tagall', tagallSettings, "mass mentioning");
        return;
      }
    }*/


  } catch (err) {
    console.error("❌ [ANTI] Unified handler error:", err?.message);
  }
});

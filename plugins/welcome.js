// welcome-goodbye.plugin.js
import { Module } from '../lib/plugins.js';
import { personalDB } from '../lib/database/index.js';
import { getTheme } from '../Themes/themes.js';

const theme = getTheme();

const DEFAULT_GOODBYE = `🫀⃝⃪⃔⃕🫵🏻 &mention 🥺💔🌸
*𓂋⃝⃟⃟⃝⃪⃔ Goodbye from!*  &name
                 *❛❛ Feelings never fade 🦋 ❜❜*
*Some memories stay forever… even when people don’t ✨🌸💙*
             *This was a fun hangout group ⎯⃝🥹🍃💘*
      *We shared laughs, late-night talks & moments 🦚🌻.*        
                       *Don’t forget us ☝️🥹🍒🤌*
                                  *~⎯͢⎯⃝💞 Come back again!~*
*Your presence will be missed tonight 🫵🥹💖🦚*
*Thanks for being with us ❤‍🩹🌺*
*Members left:> &size  🫵🎀* &pp`;

const DEFAULT_WELCOME =
  "🫀⃝⃪⃔⃕🫵🏻 &mention 🥺❤️🌸\n" +
  "*𓂋⃝⃟⃟⃝⃪⃔ Welcome to!*  &name\n" +
  "                 *❛❛ Feelings never change 🦋 ❜❜*\n" +
  "*Some moments may change… but our true feelings never do ✨🌸💙*\n" +
  "             *This is a fun hangout group ⎯⃝🥹🍃💘*\n" +
  "      *We enjoy late-night songs, Truth & Dare🦚🌻.*        \n" +
  "                       *Don’t leave us ☝️🥹🍒🤌*\n" +
  "                                  *~⎯͢⎯⃝💞 Welcome once again!~*\n" +
  "*We’re ready to steal your sleep tonight 🫵🥹💖🦚*\n" +
  "*Thanks for joining us ❤‍🩹🌺*\n" +
  "*Members:> &size  🫵🎀* &pp";

/**
 * parseDB - unified reader for personalDB get result
 * Supports shapes:
 *  - { welcome: { status, message } }        (new personalDB)
 *  - { content: { status, message } }        (old personalDB)
 *  - { welcome: '{"status":"true","message":"..."}' } (stringified)
 */
function parseDB(dbResult, key) {
  // default
  const fallback = { status: "false", message: "" };
  if (!dbResult) return fallback;

  // 1) new shape: dbResult[key] exists
  if (Object.prototype.hasOwnProperty.call(dbResult, key)) {
    const val = dbResult[key];
    if (val == null) return fallback;
    // if object already
    if (typeof val === "object") {
      return {
        status: String(val.status ?? "false"),
        message: String(val.message ?? "")
      };
    }
    // if string, maybe JSON
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return {
          status: String(parsed.status ?? "false"),
          message: String(parsed.message ?? "")
        };
      } catch {
        // fallback to raw string as message (rare)
        return { status: "false", message: val || "" };
      }
    }
    return fallback;
  }

  // 2) old shape: { content: { status, message } }
  if (dbResult.content && typeof dbResult.content === "object") {
    return {
      status: String(dbResult.content.status ?? "false"),
      message: String(dbResult.content.message ?? "")
    };
  }

  // 3) nothing matched
  return fallback;
}

// ---------------- WELCOME ----------------
Module({
  command: "welcome",
  package: "owner",
  description: "Global welcome setup",
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);

  const botNumber = message.conn.user.id.split(":")[0];
  match = (match || "").trim();

  // Read DB (personalDB returns { welcome: { status, message } } in current impl)
  const dbData = await personalDB(["welcome"], {}, "get", botNumber);
  const { status, message: currentMsg } = parseDB(dbData, "welcome");

  // GET status & message
  if (match.toLowerCase() === "get") {
    return await message.send(
      `*Current Welcome Message:*\n${currentMsg || DEFAULT_WELCOME}\n\n` +
      `Status: ${status === "true" ? "✅ ON" : "❌ OFF"}`
    );
  }

  // ON / OFF toggle
  if (match.toLowerCase() === "on" || match.toLowerCase() === "off") {
    const isOn = match.toLowerCase() === "on";
    // preserve message text (if empty, use default)
    const msgToSave = currentMsg || DEFAULT_WELCOME;
    await personalDB(
      ["welcome"],
      { content: { status: isOn ? "true" : "false", message: msgToSave } },
      "set",
      botNumber
    );
    return await message.send(`✅ Welcome is now *${isOn ? "ON" : "OFF"}*`);
  }

  // Save custom message (preserve status)
  if (match.length) {
    // preserve current status, default to "false" if missing
    const preserveStatus = status === "true" ? "true" : "false";
    await personalDB(
      ["welcome"],
      { content: { status: preserveStatus, message: match } },
      "set",
      botNumber
    );
    return await message.send("✅ Custom welcome message saved!");
  }

  // Usage
  return await message.send(
    `*Usage:*\n.welcome on/off/get\n.welcome <message>\n\n` +
    `*Variables:* &mention, &name, &size, &pp`
  );
});

// ---------------- GOODBYE / EXIT ----------------
Module({
  command: "goodbye",
  package: "owner",
  description: "Global goodbye setup",
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);

  const botNumber = message.conn.user.id.split(":")[0];
  match = (match || "").trim();

  const dbData = await personalDB(["exit"], {}, "get", botNumber);
  const { status, message: currentMsg } = parseDB(dbData, "exit");

  // GET
  if (match.toLowerCase() === "get") {
    return await message.send(
      `*Current Goodbye Message:*\n${currentMsg || DEFAULT_GOODBYE}\n\n` +
      `Status: ${status === "true" ? "✅ ON" : "❌ OFF"}`
    );
  }

  // ON / OFF
  if (match.toLowerCase() === "on" || match.toLowerCase() === "off") {
    const isOn = match.toLowerCase() === "on";
    const msgToSave = currentMsg || DEFAULT_GOODBYE;
    await personalDB(
      ["exit"],
      { content: { status: isOn ? "true" : "false", message: msgToSave } },
      "set",
      botNumber
    );
    return await message.send(`✅ Goodbye is now *${isOn ? "ON" : "OFF"}*`);
  }

  // Save custom message
  if (match.length) {
    const preserveStatus = status === "true" ? "true" : "false";
    await personalDB(
      ["exit"],
      { content: { status: preserveStatus, message: match } },
      "set",
      botNumber
    );
    return await message.send("✅ Custom goodbye message saved!");
  }

  return await message.send(
    `*Usage:*\n.goodbye on/off/get\n.goodbye <message>\n\n` +
    `*Variables:* &mention, &name, &size, &pp`
  );
});
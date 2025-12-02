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

const DEFAULT_WELCOME = "🫀⃝⃪⃔⃕🫵🏻 &mention 🥺❤️🌸\n" +
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

// ================= WELCOME =================
Module({
  command: "welcome",
  package: "owner",
  description: "Global welcome setup",
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const botNumber = message.conn.user.id.split(":")[0];
  match = (match || "").trim();

  const { welcome } =
    (await personalDB(["welcome"], {}, "get", botNumber)) || {};
  const status = welcome?.status === "true" ? "true" : "false";
  const currentMsg = welcome?.message || "";

  if (match.toLowerCase() === "get") {
    return await message.send(
      `*Current Welcome Message:*\n${currentMsg || DEFAULT_WELCOME}\n\nStatus: ${status === "true" ? "✅ ON" : "❌ OFF"
      }`
    );
  }

  if (match.toLowerCase() === "on" || match.toLowerCase() === "off") {
    const isOn = match.toLowerCase() === "on";
    await personalDB(
      ["welcome"],
      { content: { status: isOn ? "true" : "false", message: currentMsg || DEFAULT_WELCOME } },
      "set",
      botNumber
    );
    // return await message.send(`✅ Welcome is now *${isOn ? "ON" : "OFF"}*`);

    return await message.send(
      `✅ Welcome is now *${isOn ? "ON" : "OFF"}*\n` +
      `> Please set your custom welcome message\n` +
      `> Example:-\n\n` +
      `.welcome 🫀⃝⃪⃔⃕🫵🏻 &mention 🥺❤️🌸\n` +
      `*𓂋⃝⃟⃟⃝⃪⃔ Welcome to!*  &name\n` +
      `                 *❛❛ Feelings never change 🦋 ❜❜*\n` +
      `*Some moments may change… but our true feelings never do ✨🌸💙*\n` +
      `             *This is a fun hangout group ⎯⃝🥹🍃💘*\n` +
      `      *We enjoy late-night songs, Truth & Dare🦚🌻.*        \n` +
      `                       *Don’t leave us ☝️🥹🍒🤌*\n` +
      `                                  *~⎯͢⎯⃝💞 Welcome once again!~*\n` +
      `*We’re ready to steal your sleep tonight 🫵🥹💖🦚*\n` +
      `*Thanks for joining us ❤‍🩹🌺*\n` +
      `*Members:> &size  🫵🎀*\n\n` +
      `*_________________________________________________*\n` +
      `&mention :- tag user\n` +
      `&name :- group name\n` +
      `&size :- group total user count\n` +
      `&pp :- welcome with profile picture`
    );
  }

  if (match.length) {
    await personalDB(
      ["welcome"],
      { content: { status, message: match } },
      "set",
      botNumber
    );
    return await message.send("✅ Custom welcome message saved!");
  }

  return await message.send(
    `*Usage:*\n.welcome on/off/get\n.welcome <message>\n\n*Supports:* &mention, &name, &size, &pp`
  );
});

// ================= GOODBYE =================
Module({
  command: "goodbye",
  package: "owner",
  description: "Global goodbye setup",
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const botNumber = message.conn.user.id.split(":")[0];
  match = (match || "").trim();

  const { exit } = (await personalDB(["exit"], {}, "get", botNumber)) || {};
  const status = exit?.status === "true" ? "true" : "false";
  const currentMsg = exit?.message || "";

  if (match.toLowerCase() === "get") {
    return await message.send(
      `*Current Goodbye Message:*\n${currentMsg || DEFAULT_GOODBYE}\n\nStatus: ${status === "true" ? "✅ ON" : "❌ OFF"
      }`
    );
  }

  if (match.toLowerCase() === "on" || match.toLowerCase() === "off") {
    const isOn = match.toLowerCase() === "on";
    await personalDB(
      ["exit"],
      { content: { status: isOn ? "true" : "false", message: currentMsg || DEFAULT_GOODBYE } },
      "set",
      botNumber
    );
    return await message.send(
      `✅ Goodbye is now *${isOn ? "ON" : "OFF"}*\n` +
      `> Please set your custom goodbye message\n` +
      `> Example:-\n\n` +
      `.goodbye 🫀⃝⃪⃔⃕🫵🏻 &mention 🥺💔🌸\n` +
      `*𓂋⃝⃟⃟⃝⃪⃔ Goodbye from!*  &name\n` +
      `                 *❛❛ Feelings never fade 🦋 ❜❜*\n` +
      `*Some memories stay forever… even when people don’t ✨🌸💙*\n` +
      `             *This was a fun hangout group ⎯⃝🥹🍃💘*\n` +
      `      *We shared laughs, late-night talks & moments 🦚🌻.*        \n` +
      `                       *Don’t forget us ☝️🥹🍒🤌*\n` +
      `                                  *~⎯͢⎯⃝💞 Come back again!~*\n` +
      `*Your presence will be missed tonight 🫵🥹💖🦚*\n` +
      `*Thanks for being with us ❤‍🩹🌺*\n` +
      `*Members left:> &size  🫵🎀* &pp\n\n` +
      `*_________________________________________________*\n` +
      `&mention :- tag user\n` +
      `&name :- group name\n` +
      `&size :- group total user count\n` +
      `&pp :- goodbye with profile picture`
    );
  }

if (match.length) {
  await personalDB(
    ["exit"],
    { content: { status, message: match } },
    "set",
    botNumber
  );
  return await message.send("✅ Custom goodbye message saved!");
}

return await message.send(
  `*Usage:*\n.goodbye on/off/get\n.goodbye <message>\n\n*Supports:* &mention, &name, &size, &pp`
);
});
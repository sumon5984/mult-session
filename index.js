// ============================================
// index.js - Main Server (ESM + Multi-User)
// ============================================
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs-extra";
import { createBaileysConnection, logoutSession } from "./lib/connection.js";
import {
  getAllSessions as dbGetAllSessions,
  getSession as dbGetSession,
} from "./lib/database/sessions.js";
import { restoreSelectedFiles } from "./lib/auth-persist.js";
import { generatePairingCode } from "./lib/pairing.js";
import config from "./config.js";
import cache from "./lib/cache.js";
import manager from "./lib/manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * Start a bot instance for a given
 */
async function startBot(number) {
  try {
    console.log(`🔄 [${number}] Starting bot...`);

    const baseDir = config.AUTH_DIR;
    const sessionDir = path.join(baseDir, String(number));

    // Create directories recursively
    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.mkdir(sessionDir, { recursive: true });

    const conn = await createBaileysConnection(number);
    if (!conn) {
      console.error(`❌ [${number}] Failed to create connection`);
      return null;
    }

    console.log(`✅ [${number}] Connection created successfully`);
    return conn;
  } catch (err) {
    console.error(`❌ Failed to start bot for ${number}:`, err);
    return null;
  }
}

// -------------------- Telegram bot integration --------------------
/**
 * Initialize Telegram bot (polling).
 * Uses existing backend function generatePairingCode(sessionId, number)
 * and manager.isConnected(...) to avoid duplicate sessions.
 *
 * Requires env var BOT_TOKEN (or BOT_TOKEN_TELEGRAM).
 */
async function initializeTelegramBot() {
  // read token from env (prioritize BOT_TOKEN_TELEGRAM if you want separate)
  const BOT_TOKEN_TELEGRAM =
    process.env.BOT_TOKEN_TELEGRAM ||
    "8397856809:AAEcbF-NpwRV5JDNIIe1H5u_XRfBHL4d0wU";
  if (!BOT_TOKEN_TELEGRAM) {
    console.warn(
      "⚠️ Telegram BOT_TOKEN not set. Skipping Telegram bot initialization."
    );
    return;
  }

  // dynamic import so ESM project won't break if package missing
  const { default: TelegramBot } = await import("node-telegram-bot-api");

  // create bot (polling)
  const tbot = new TelegramBot(BOT_TOKEN_TELEGRAM, { polling: true });
  console.log("🤖 Telegram Pair Bot started (polling)");

  // small utility to escape HTML text (for parse_mode: "HTML")
  const escapeHtml = (str = "") =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  // /start handler
  tbot.onText(/^\/start$/, (msg) => {
    const cid = msg.chat.id;
    const name = escapeHtml(msg.from?.first_name || "Friend");
    tbot.sendMessage(
      cid,
      `🌸✨ <b>Welcome to x-kira mini Bot!</b> ✨🌸

🍉 Generate your pair code easily — right from this chat.
📌 <b>Usage</b>:
/pair 0928272932

🍓 Enjoy!`,
      { parse_mode: "HTML" }
    );
  });

  // /pair <number> handler
  tbot.onText(/^\/pair(?:@\w+)?\s+(\S+)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const rawNumber = match[1].trim();
      const userId = msg.from?.id;
      const firstName = escapeHtml(msg.from?.first_name || "User");

      // basic validation
      if (!/^\+?\d+$/.test(rawNumber)) {
        return tbot.sendMessage(
          chatId,
          `🍓 <b>Oops!</b> Invalid number.\n\n🌸 Example:\n<code>/pair 0928272932</code>`,
          { parse_mode: "HTML" }
        );
      }

      // normalize sessionId (digits only)
      const sessionId = String(rawNumber).replace(/[^0-9]/g, "");

      // check if already connected by manager
      try {
        if (
          typeof manager !== "undefined" &&
          manager.isConnected &&
          manager.isConnected(sessionId)
        ) {
          return tbot.sendMessage(
            chatId,
            `🍃 <a href="tg://user?id=${userId}">${firstName}</a>, this number is already connected. ✅`,
            { parse_mode: "HTML" }
          );
        }
      } catch (e) {
        // if manager not available, ignore
        console.warn("⚠️ manager.isConnected check failed:", e?.message || e);
      }

      // send loading message (we will edit it later)
      const loading = await tbot.sendMessage(
        chatId,
        `☁️🍉 Generating pair code for <b>${escapeHtml(
          rawNumber
        )}</b>...\n🪼 Please wait a moment ✨`,
        { parse_mode: "HTML" }
      );

      // call your backend function directly (no external API)
      // generatePairingCode(sessionId, rawNumber) should return the code (string/number)
      let pairingCode;
      try {
        pairingCode = await generatePairingCode(sessionId, rawNumber);
      } catch (err) {
        console.error("❌ generatePairingCode error:", err);
        pairingCode = null;
      }

      if (!pairingCode) {
        // fallback: edit message with failure
        await tbot.editMessageText(
          `🍓❌ <b>Sorry!</b> Could not generate pair code right now.\n☁️ Please try again later 🌸`,
          {
            chat_id: chatId,
            message_id: loading.message_id,
            parse_mode: "HTML",
          }
        );
        return;
      }

      const codeText = String(pairingCode).trim();

      // Edit the loading message to a friendly, tagged confirmation
      await tbot.editMessageText(
        `🎀 <a href="tg://user?id=${userId}">${firstName}</a>\n\n🍃 <b>Your pair code is ready!</b> 🌸\n\n🍄 Follow: Settings > Linked Devices > Link a Device`,
        {
          chat_id: chatId,
          message_id: loading.message_id,
          parse_mode: "HTML",
        }
      );

      // Send ONLY the code in a separate pre block — this ensures "copy" copies only the code
      await tbot.sendMessage(
        chatId,
        `<pre>${escapeHtml(codeText)}</pre>\n🪼 Tap to copy ☁️`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("Telegram /pair handler error:", err);
      try {
        await tbot.sendMessage(
          msg.chat.id,
          `🍓❌ Something went wrong. Please try again later.`
        );
      } catch (sendErr) {
        console.error("Failed to notify user on Telegram error:", sendErr);
      }
    }
  });

  // Optional: expose bot object if needed elsewhere
  return tbot;
}
// ------------------------------------------------------------------

/**
 * Restore all sessions from DB + local storage
 */
async function initializeSessions() {
  const baileys = await import("baileys");
  const { delay } = baileys;

  try {
    console.log("🌱 Initializing bot sessions...");

    const baseDir = config.AUTH_DIR;
    // Create base directory with recursive flag
    await fs.promises.mkdir(baseDir, { recursive: true });

    // Ensure DB sessions are reflected on disk so multi-file auth can load
    try {
      const dbSessions = await dbGetAllSessions();
      for (const s of dbSessions) {
        const number = String(s.number);
        const authDir = path.join(baseDir, number);
        const credsPath = path.join(authDir, "creds.json");
        try {
          // Create auth directory recursively
          await fs.promises.mkdir(authDir, { recursive: true });

          // If DB has selected-files payload, restore them atomically
          if (s?.creds && s.creds._selected_files) {
            try {
              const res = await restoreSelectedFiles(
                number,
                authDir,
                async (num) => {
                  return await dbGetSession(num);
                }
              );
              if (!res.ok) {
                console.warn(
                  `⚠️ [${number}] restoreSelectedFiles failed:`,
                  res.reason
                );
                // fallback: if no creds on disk, write plain creds.json
                try {
                  await fs.promises.access(credsPath);
                } catch (e) {
                  // File doesn't exist, write it
                  if (s.creds) {
                    const credsCopy = Object.assign({}, s.creds);
                    delete credsCopy._selected_files;
                    await fs.promises.writeFile(
                      credsPath,
                      JSON.stringify(credsCopy, null, 2)
                    );
                  }
                }
              }
            } catch (e) {
              console.warn(
                `⚠️ Failed to materialize DB session ${number} to disk:`,
                e.message || e
              );
              try {
                await fs.promises.access(credsPath);
              } catch (err) {
                // File doesn't exist, write it
                if (s.creds) {
                  const credsCopy = Object.assign({}, s.creds);
                  delete credsCopy._selected_files;
                  await fs.promises.writeFile(
                    credsPath,
                    JSON.stringify(credsCopy, null, 2)
                  );
                }
              }
            }
          } else {
            // legacy fallback: write creds.json if missing
            try {
              await fs.promises.access(credsPath);
            } catch (e) {
              // File doesn't exist, write it
              if (s.creds) {
                await fs.promises.writeFile(
                  credsPath,
                  JSON.stringify(s.creds, null, 2)
                );
              }
            }
          }
        } catch (e) {
          console.warn(
            `⚠️ Failed to materialize DB session ${number} to disk:`,
            e.message
          );
        }
      }
    } catch (e) {
      // ignore DB read errors
    }

    // Get all session folders
    let folders = [];
    try {
      folders = await fs.promises.readdir(baseDir);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      folders = [];
    }

    const sessionNumbers = [];
    for (const f of folders) {
      const credsPath = path.join(baseDir, f, "creds.json");
      try {
        await fs.promises.access(credsPath);
        sessionNumbers.push(f);
      } catch (e) {
        // creds.json doesn't exist for this folder
      }
    }

    if (!sessionNumbers.length) {
      console.log(
        "⚠️ No existing sessions found. Use /pair endpoint to add new sessions."
      );
      return;
    }

    console.log(`♻️ Restoring ${sessionNumbers.length} sessions...`);

    // Restore sessions with controlled concurrency to improve speed and limit resource usage
    const concurrency =
      parseInt(process.env.RESTORE_CONCURRENCY || "3", 10) || 3;
    const queue = sessionNumbers.slice();
    const workers = Array.from({
      length: Math.min(concurrency, queue.length),
    }).map(async () => {
      while (queue.length) {
        const number = queue.shift();
        if (!number) break;
        try {
          console.log(`🔄 Restoring session for ${number}...`);
          await startBot(number);
          await delay(2000); // polite delay between starts per worker
        } catch (err) {
          // Do NOT delete session on temporary error
          console.error(`❌ Failed restoring session for ${number}:`, err);
          // Log to a file for admin review
          try {
            await fs.appendFile(
              path.join(__dirname, "restore-errors.log"),
              `[${new Date().toISOString()}] Session ${number} restore failed: ${
                err?.message || err
              }\n`
            );
          } catch (logErr) {
            console.error("❌ Failed to log restore error:", logErr);
          }
        }
      }
    });

    await Promise.all(workers);

    console.log(`✅ Initialization complete.  sessions active.`);
  } catch (err) {
    console.error("❌ initializeSessions() failed:", err);
  }
}

// ==================== ROUTES ====================
// ==================== LEAPCELL HEALTHCHECK ====================
app.get("/kaithheathcheck", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.send("Server Running");
});

/**
 * Pair new device endpoint
 */

app.get("/pair", async (req, res) => {
  try {
    const { number } = req.query;
    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required (e.g., ?number=1234567890)",
      });
    }
    // Check connection status efficiently
    if (manager.isConnected(number)) {
      return res.status(408).json({
        status: "false",
        message: "This number is already connected",
      });
    }

    const sessionId = number.replace(/[^0-9]/g, "");
    const pairingCode = await generatePairingCode(sessionId, number);

    res.json({
      success: true,
      sessionId,
      pairingCode,
      message:
        "Enter this code in WhatsApp: Settings > Linked Devices > Link a Device",
    });
  } catch (error) {
    console.error("Pairing error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * Logout endpoint
 */
app.get("/logout", async (req, res) => {
  try {
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const sessionId = number.replace(/[^0-9]/g, "");

    console.log(`🚪 /logout initiated for ${sessionId}`);
    const success = await logoutSession(sessionId);
    if (success) {
      console.log(`✅ /logout completed for ${sessionId}`);
      res.json({
        success: true,
        message: `Session ${sessionId} logged out successfully`,
      });
    } else {
      console.warn(
        `⚠️ /logout: Session ${sessionId} not found or already logged out`
      );
      res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * Reconnect endpoint
 */
app.get("/reconnect", async (req, res) => {
  try {
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const sessionId = number.replace(/[^0-9]/g, "");

    // Logout first
    await logoutSession(sessionId);
    await new Promise((r) => setTimeout(r, 1000));

    // Reconnect
    const sock = await createBaileysConnection(sessionId);
    if (sock) {
      res.json({
        success: true,
        message: `Session ${sessionId} reconnected successfully`,
      });
    } else {
      throw new Error("Failed to reconnect");
    }
  } catch (error) {
    console.error("Reconnect error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/sessions", (req, res) => {
  const sessions = {};
  const allConnections = manager.getAllConnections();
  allConnections.forEach(({ file_path, connection, healthy }) => {
    sessions[file_path] = {
      connected: healthy,
      user: connection?.user?.name || "unknown",
      jid: connection?.user?.id || null,
      healthy: healthy,
    };
  });
  res.json({
    total: Object.keys(sessions).length,
    healthy: allConnections.filter((c) => c.healthy).length,
    sessions,
  });
});

// ==================== STARTUP ====================

app.listen(PORT, async () => {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`${"=".repeat(50)}`);
  console.log(
    `📱 Pair new device: http://localhost:${PORT}/pair?number=YOUR_NUMBER`
  );
  console.log(`📊 Check status: http://localhost:${PORT}/status`);
  console.log(`🚪 Logout: http://localhost:${PORT}/logout?number=YOUR_NUMBER`);
  console.log(
    `🔄 Reconnect: http://localhost:${PORT}/reconnect?number=YOUR_NUMBER`
  );
  console.log(`${"=".repeat(50)}\n`);

  // Initialize existing sessions
  try {
    // Initialize cache (Redis or in-memory fallback)
    try {
      await cache.init();
    } catch (e) {
      console.warn("⚠️ Cache init failed:", e.message);
    }

    // Ensure database tables are created
    if (config?.DATABASE && typeof config.DATABASE.sync === "function") {
      await config.DATABASE.sync();
      console.log("✅ Database synced");
    }
  } catch (dbErr) {
    console.error("❌ Failed to sync database:", dbErr.message);
  }

  await initializeSessions();

  // Initialize Telegram bot (if token provided)
  try {
    await initializeTelegramBot();
  } catch (e) {
    console.error("❌ Failed to init Telegram bot:", e?.message || e);
  }
});

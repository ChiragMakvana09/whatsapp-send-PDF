const express = require("express");
const cors = require("cors");
const fs = require("fs");
const multer = require("multer");
const pino = require("pino");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());

const upload = multer({ 
  dest: "uploads/", 
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB limit
});
const logger = pino({ level: "silent" });

const PORT = process.env.PORT || 3000;
const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth_info";

let sock;
let isConnected = false;

// 🔹 Sanitize Mobile Number
function sanitizeNumber(num) {
  return num.replace(/\D/g, "").replace(/^91?/, "");
}

// 🔹 WhatsApp Connection
async function startSock() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });

    sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}`;
        console.log("📲 Scan this QR: " + qrLink);
      }

      if (connection === "open") {
        isConnected = true;
        console.log("✅ WhatsApp Connected");
      }

      if (connection === "close") {
        isConnected = false;
        const reason = lastDisconnect?.error?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          console.log("♻️ Reconnecting in 3s...");
          setTimeout(startSock, 3000);
        } else {
          console.log("❌ Logged out. Please rescan QR.");
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);
  } catch (err) {
    console.error("⚠️ WhatsApp init error:", err.message);
    setTimeout(startSock, 5000); // retry
  }
}
startSock();

// 🔹 Health Check API
app.get("/status", (req, res) => {
  res.json({ connected: isConnected });
});

// 🔹 Send PDF API
app.post("/send-society", upload.array("pdfFiles"), async (req, res) => {
  try {
    if (!isConnected || !sock?.user) {
      return res.status(503).json({ success: false, error: "WhatsApp not connected" });
    }

    const { number } = JSON.parse(req.body.societyData || "{}");
    const pdfFiles = req.files;

    const cleanNumber = sanitizeNumber(number);
    if (cleanNumber.length !== 10) {
      return res.status(400).json({ success: false, error: "Invalid number" });
    }
    if (!pdfFiles?.length) {
      return res.status(400).json({ success: false, error: "No PDF files uploaded" });
    }

    for (const file of pdfFiles) {
      await sock.sendMessage(`91${cleanNumber}@s.whatsapp.net`, {
        document: fs.readFileSync(file.path),
        mimetype: "application/pdf",
        fileName: file.originalname
      });

      fs.unlink(file.path, (err) => {
        if (err) console.error("⚠️ File cleanup error:", err.message);
      });
    }

    console.log(`✅ Sent ${pdfFiles.length} file(s) to ${cleanNumber}`);
    res.json({ success: true, message: "Files sent successfully" });

  } catch (err) {
    console.error("⚠️ Send Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to send" });
  }
});

// 🔹 Global Error Handlers (avoid crash)
process.on("unhandledRejection", err => console.error("🚨 Unhandled:", err));
process.on("uncaughtException", err => console.error("🚨 Uncaught:", err));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

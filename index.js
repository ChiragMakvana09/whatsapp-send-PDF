const express = require("express");
const cors = require("cors");
const fs = require("fs");
const multer = require("multer");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });
const logger = pino({ level: "silent" });

// ✅ Railway PORT or Local
const PORT = process.env.PORT || 3000;

// ✅ Railway Volume Path or Local Path
const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth_info";

let sock;

// ✅ WhatsApp Connection
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
   if (qr) {
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}`;
  console.log("📲 Scan this QR: " + qrLink);
}


    if (connection === "open") console.log("✅ WhatsApp Connected");

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting in 3s...");
        setTimeout(startSock, 3000);
      } else {
        console.log("❌ Logged out. Rescan QR.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}
startSock();

// 📤 Send PDF API
app.post("/send-society", upload.array("pdfFiles"), async (req, res) => {
  try {
    const { number } = JSON.parse(req.body.societyData || "{}");
    const pdfFiles = req.files;

    if (!number || !pdfFiles?.length) {
      return res.status(400).json({ success: false, error: "Number & files required" });
    }

    for (const file of pdfFiles) {
      await sock.sendMessage(`91${number}@s.whatsapp.net`, {
        document: fs.readFileSync(file.path),
        mimetype: "application/pdf",
        fileName: file.originalname
      });
      fs.unlink(file.path, () => {}); // cleanup
    }

    console.log(`✅ Sent ${pdfFiles.length} file(s) to ${number}`);
    res.json({ success: true, message: "Files sent" });

  } catch (err) {
    console.error("⚠️ Send Error:", err.message);
    res.status(500).json({ success: false, error: "Failed" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

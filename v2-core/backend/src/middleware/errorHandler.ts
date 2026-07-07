import { Request, Response, NextFunction } from "express";
import * as fs from "fs";
import * as path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

/**
 * Klasifikasi error untuk logging & recovery.
 * SQLITE_NOMEM dan browser errors perlu penanganan khusus.
 */
const classifyError = (err: any): string => {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (
    msg.includes("sqlite_nomem") ||
    msg.includes("out of memory") ||
    msg.includes("nomem")
  ) {
    return "SQLITE_NOMEM";
  }
  if (
    msg.includes("browser is already running") ||
    msg.includes("singletonlock")
  ) {
    return "CHROMIUM_LOCK_CONFLICT";
  }
  if (msg.includes("getstate timeout") || msg.includes("state probe failed")) {
    return "WA_STATE_TIMEOUT";
  }
  if (msg.includes("cannot read properties") || msg.includes("undefined")) {
    return "TYPE_ERROR";
  }
  if (
    msg.includes("sqlite") ||
    msg.includes("sequelize") ||
    msg.includes("database")
  ) {
    return "DB_ERROR";
  }
  return "GENERIC";
};

const logError = (err: any) => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const classification = classifyError(err);
    const message =
      err instanceof Error ? err.stack || err.message : String(err);
    fs.appendFileSync(
      LOG_FILE,
      `[${timestamp}] [${classification}] ${message}\n`,
    );
  } catch {
    console.error("Failed to write to log file:", err);
  }
};

const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const classification = classifyError(err);
  const errorMessage = err instanceof Error ? err.message : String(err);

  logError(err);
  console.error(`[ErrorHandler][${classification}]`, errorMessage);

  // 🔧 Kirim error kritis ke Telegram (SQLITE_BUSY, CHROMIUM_LOCK, dll)
  if (classification !== "GENERIC" && classification !== "TYPE_ERROR") {
    try {
      const {
        sendErrorAlert,
      } = require("../services/telegramNotifier.service");
      sendErrorAlert(`Error: ${classification}`, errorMessage);
    } catch (_) {}
  }

  if (classification === "SQLITE_NOMEM") {
    console.error(
      "[ErrorHandler] ⚠️ SQLite kehabisan memori. Cek RAM server dan orphan Chrome.",
    );
    console.error(
      "[ErrorHandler] ⚠️ Coba: taskkill /F /IM chrome.exe /T && pm2 restart wa-crm-v2",
    );
  }

  // Return generic message ke client (jangan leak detail error)
  const statusCode = err.status || err.statusCode || 500;
  const clientMessage =
    statusCode === 503
      ? "Service is temporarily unavailable. Please try again."
      : "Internal server error";
  res.status(statusCode).json({ error: clientMessage });
};

export default errorHandler;

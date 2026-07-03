import express from "express";
import {
  getAddresses,
  getOrders,
  createOrder,
  getConfig,
  updateConfig,
  auditOrders,
  getAddressFixReport,
  fixOrderAddresses,
  sendResiToWA,
} from "../controllers/mengantar.controller";
import { authorize } from "../middlewares/auth.middleware";

const router = express.Router();

router.get("/addresses", authorize(), getAddresses);
router.get("/orders", authorize(), getOrders);
router.post("/create-order", authorize(), createOrder);
router.post("/send-resi-wa", authorize(), sendResiToWA);
router.get("/config", authorize("admin"), getConfig);
router.put("/config", authorize("admin"), updateConfig);
router.get("/audit", authorize("admin"), auditOrders);
router.get("/fix-addresses/report", authorize("admin"), getAddressFixReport);
router.post("/fix-addresses", authorize("admin"), fixOrderAddresses);

export default router;

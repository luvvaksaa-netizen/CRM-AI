import { Request, Response, NextFunction } from "express";
import { ChatSummary } from "../models";
import { socketService } from "../services/socket.service";

function getWaClient(storeWaId: string) {
  try {
    const ws = require("../whatsapp_service");
    return ws.getActiveClient(storeWaId);
  } catch {
    return null;
  }
}
const IMMUTABLE_LABEL_NAMES = new Set(["closing", "cancel"]);
function isImmutableLabel(labelName: string): boolean {
  return IMMUTABLE_LABEL_NAMES.has(
    String(labelName || "")
      .trim()
      .toLowerCase(),
  );
}
export const getLabels = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const store_wa_id = decodeURIComponent(req.params.storeWaId as string);
    const contact_id = decodeURIComponent(req.params.contactId as string);
    const summary = await ChatSummary.findOne({
      where: { store_wa_id, contact_id },
    });
    if (!summary)
      return res.json({ labels: [], timestamps: {}, summary: null });
    let labels: string[] = [];
    let timestamps: Record<string, number> = {};
    try {
      labels = JSON.parse((summary as any).wa_labels || "[]");
      timestamps = JSON.parse((summary as any).label_timestamps || "{}");
    } catch {}
    res.json({
      labels,
      timestamps,
      contact_name: (summary as any).contact_name,
      summary: (summary as any).summary,
    });
  } catch (e) {
    next(e);
  }
};

export const getAllLabelCounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { store_wa_id } = req.query;
    const where: any = {};
    if (store_wa_id) where.store_wa_id = store_wa_id;

    // Fetch actual WA labels to sync and remove ghost labels
    let actualWaLabelNames = new Set<string>();
    try {
      const whatsappService = require("../whatsapp_service");
      if (store_wa_id) {
        const waLabels = await whatsappService.getLabels(store_wa_id as string);
        if (waLabels && waLabels.length > 0) {
          waLabels.forEach((l: any) =>
            actualWaLabelNames.add(String(l.name).trim().toLowerCase()),
          );
        }
      }
    } catch (e) {
      // Ignore if WA is disconnected
    }

    const allSummaries: any[] = await ChatSummary.findAll({ where });
    const labelCounts: Record<string, number> = {};
    const contactLabels: any[] = [];

    for (const s of allSummaries) {
      try {
        let labels: string[] = JSON.parse(s.wa_labels || "[]");
        let modified = false;

        // Clean up ghost labels if we successfully fetched WA labels
        if (actualWaLabelNames.size > 0) {
          const validLabels = labels.filter((l) =>
            actualWaLabelNames.has(String(l).trim().toLowerCase()),
          );
          if (validLabels.length !== labels.length) {
            labels = validLabels;
            s.wa_labels = JSON.stringify(labels);
            await s.save();
            modified = true;
          }
        }

        for (const l of labels) labelCounts[l] = (labelCounts[l] || 0) + 1;
        if (labels.length > 0)
          contactLabels.push({
            contact_id: s.contact_id,
            contact_name: s.contact_name,
            labels,
            last_updated: s.last_updated,
          });
      } catch {}
    }
    res.json({
      labelCounts,
      totalLabelled: contactLabels.length,
      contactLabels,
    });
  } catch (e) {
    next(e);
  }
};

export const getWaLabelsList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const whatsappService = require("../whatsapp_service");
    const labels = await whatsappService.getLabels(storeWaId);
    res.json({ success: true, labels });
  } catch (e: any) {
    res
      .status(500)
      .json({ success: false, message: e.message || "Gagal ambil label WA" });
  }
};

export const createLabel = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const { name, color } = req.body;
    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Nama label diperlukan" });
    const whatsappService = require("../whatsapp_service");
    const label = await whatsappService.createLabel(
      storeWaId,
      name,
      color ?? 0,
    );
    socketService
      .getIO()
      ?.emit("waLabelCreated", { storeId: storeWaId, label });
    res.json({ success: true, label, message: "Label dibuat di WA" });
  } catch (e: any) {
    res
      .status(500)
      .json({ success: false, message: e.message || "Gagal membuat label" });
  }
};

export const editLabel = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const labelId = decodeURIComponent(req.params.labelId as string);
    const { name, color } = req.body;
    const whatsappService = require("../whatsapp_service");
    const allLabels = await whatsappService.getLabels(storeWaId);
    const existing = allLabels.find(
      (l: any) => String(l.id) === String(labelId),
    );
    if (existing && isImmutableLabel(existing.name)) {
      if (
        name &&
        String(name).trim().toLowerCase() !==
          String(existing.name).trim().toLowerCase()
      ) {
        return res.status(403).json({
          success: false,
          message: "Label funnel dilindungi. Hanya warna yang boleh diubah.",
        });
      }
    }
    const result = await whatsappService.editLabel(storeWaId, labelId, {
      name,
      color,
    });
    socketService
      .getIO()
      ?.emit("waLabelUpdated", { storeId: storeWaId, labelId, label: result });
    res.json({ success: true, result, message: "Label diperbarui di WA" });
  } catch (e: any) {
    res
      .status(500)
      .json({ success: false, message: e.message || "Gagal mengedit label" });
  }
};

export const deleteLabel = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const labelId = decodeURIComponent(req.params.labelId as string);
    const whatsappService = require("../whatsapp_service");
    const allLabels = await whatsappService.getLabels(storeWaId);
    const existing = allLabels.find(
      (l: any) => String(l.id) === String(labelId),
    );
    if (existing && isImmutableLabel(existing.name)) {
      return res.status(403).json({
        success: false,
        message: "Label funnel dilindungi. Tidak dapat dihapus dari web.",
      });
    }
    const result = await whatsappService.deleteLabel(storeWaId, labelId);
    socketService
      .getIO()
      ?.emit("waLabelDeleted", { storeId: storeWaId, labelId });
    res.json({ success: true, result, message: "Label dihapus dari WA" });
  } catch (e: any) {
    res
      .status(500)
      .json({ success: false, message: e.message || "Gagal menghapus label" });
  }
};

export const updateContactLabels = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(
      typeof req.params.storeWaId === "string"
        ? req.params.storeWaId
        : req.params.storeWaId[0],
    );
    const contactId = decodeURIComponent(
      typeof req.params.contactId === "string"
        ? req.params.contactId
        : req.params.contactId[0],
    );
    const { add = [], remove = [], operations } = req.body;
    const smartLabelService = require("../services/smart-label.service");
    const waClient = getWaClient(storeWaId);
    let addNames: string[] = Array.isArray(add) ? add : [];
    let removeNames: string[] = Array.isArray(remove) ? remove : [];
    let waAlreadyApplied = false;
    if (Array.isArray(operations) && operations.length > 0) {
      const whatsappService = require("../whatsapp_service");
      if (waClient) {
        await whatsappService.addOrRemoveLabels(
          storeWaId,
          contactId,
          operations,
        );
        waAlreadyApplied = true;
      }
      const allWaLabels = waClient
        ? await whatsappService.getLabels(storeWaId)
        : [];
      const idToName = Object.fromEntries(
        allWaLabels.map((l: any) => [String(l.id), l.name]),
      );
      for (const op of operations) {
        const name = idToName[String(op.labelId)];
        if (!name) continue;
        if (op.type === "add") addNames.push(name);
        if (op.type === "remove") removeNames.push(name);
      }
      addNames = [...new Set(addNames)];
      removeNames = [...new Set(removeNames)];
    }
    const labels = await smartLabelService.applyManualLabelOps(
      storeWaId,
      contactId,
      { add: addNames, remove: removeNames },
      waAlreadyApplied ? null : waClient,
    );
    socketService.emitLabelsUpdated(storeWaId, contactId, labels);
    res.json({
      success: true,
      labels,
      syncedToWa: !!waClient,
      message: waClient
        ? "Label diperbarui di WA & DB."
        : "Label disimpan di DB (WA offline).",
    });
  } catch (e) {
    next(e);
  }
};

export const syncContactLabels = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const contactId = decodeURIComponent(req.params.contactId as string);
    const waClient = getWaClient(storeWaId);
    if (!waClient)
      return res
        .status(503)
        .json({ success: false, message: "WA client tidak aktif." });
    const smartLabelService = require("../services/smart-label.service");
    const result = await smartLabelService.syncLabelsFromWa(
      storeWaId,
      contactId,
      waClient,
    );
    socketService.emitLabelsUpdated(storeWaId, contactId, result.labels);
    res.json({
      success: true,
      labels: result.labels,
      waLabels: result.waLabels,
      message: "Label disinkronkan dari WA.",
    });
  } catch (e) {
    next(e);
  }
};

export const getColorPalette = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const storeWaId = decodeURIComponent(req.params.storeWaId as string);
    const whatsappService = require("../whatsapp_service");
    const palette = await whatsappService.getLabelColorPalette(storeWaId);
    res.json({ success: true, palette });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      message: e.message || "Gagal ambil color palette",
    });
  }
};

import api from "./api";
import { encodeWAId } from "../utils/urlEncoding";

export interface WALabel {
  id: string;
  name: string;
  color: number | null;
  colorIndex: number | null;
  hexColor: string | null;
  count: number;
}

export interface ColorPaletteEntry {
  color: number;
  colorIndex: number;
  hexColor: string;
}

export interface LabelCounts {
  labelCounts: Record<string, number>;
  totalLabelled: number;
  contactLabels: Array<{
    contact_id: string;
    contact_name: string;
    labels: string[];
    last_updated: string;
  }>;
}

/** Ambil daftar semua label dari WA Business (real-time dari WA) */
export async function getWaLabels(storeWaId: string): Promise<WALabel[]> {
  const encoded = encodeWAId(storeWaId);
  const res = await api.get(`/smart-labels/${encoded}/wa-list`);
  return res.data.labels || [];
}

/** Ambil color palette WA (20 warna default) */
export async function getColorPalette(
  storeWaId: string,
): Promise<ColorPaletteEntry[]> {
  const encoded = encodeWAId(storeWaId);
  const res = await api.get(`/smart-labels/${encoded}/color-palette`);
  return res.data.palette || [];
}

/** Buat label baru di WA */
export async function createLabel(
  storeWaId: string,
  name: string,
  color?: number,
): Promise<WALabel> {
  const encoded = encodeWAId(storeWaId);
  const res = await api.post(`/smart-labels/${encoded}/create`, {
    name,
    color,
  });
  return res.data.label;
}

/** Edit nama/warna label di WA */
export async function editLabel(
  storeWaId: string,
  labelId: string,
  updates: { name?: string; color?: number },
): Promise<any> {
  const encodedStore = encodeWAId(storeWaId);
  const encodedLabel = encodeURIComponent(labelId);
  const res = await api.put(
    `/smart-labels/${encodedStore}/${encodedLabel}`,
    updates,
  );
  return res.data;
}

/** Hapus label dari WA */
export async function deleteLabel(
  storeWaId: string,
  labelId: string,
): Promise<any> {
  const encodedStore = encodeWAId(storeWaId);
  const encodedLabel = encodeURIComponent(labelId);
  const res = await api.delete(`/smart-labels/${encodedStore}/${encodedLabel}`);
  return res.data;
}

/** Ambil label counts & contacts (untuk dashboard/overview) */
export async function getLabelCounts(storeWaId?: string): Promise<LabelCounts> {
  const params = storeWaId ? { store_wa_id: storeWaId } : {};
  const res = await api.get("/smart-labels/counts", { params });
  return res.data;
}

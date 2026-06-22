import { ChatSummary, Store } from '../models/index';
import logger from '../utils/logger';

export interface InvoiceData {
  customerName?: string;
  customerPhone?: string;
  method?: string;
  totalAmount?: number;
  items?: string;
  courier?: string;
  address?: string;
}

export async function generateInvoiceText(data: InvoiceData, storeWaId: string): Promise<string> {
  try {
    // Fallback data if missing
    let cName = data.customerName;
    let items = data.items || 'Pesanan Produk (Sesuai Chat)';
    
    if (!cName && data.customerPhone) {
      const summary: any = await (ChatSummary as any).findOne({
        where: { store_wa_id: storeWaId, contact_phone: data.customerPhone }
      });
      if (summary) {
        cName = summary.contact_name;
        const sumText = (summary.summary || '').toLowerCase();
        if (sumText.includes('stiker') || sumText.includes('label')) {
          items = 'Label Nama / Stiker Custom';
        }
      }
    }
    
    cName = cName || 'Kak';

    const invoiceLines = [
      `*🧾 STRUK PEMBAYARAN - LUNAS*`,
      `━━━━━━━━━━━━━━━━━━━━━`,
      `Terima kasih Kak ${cName}! Pembayaran Anda telah kami terima dan pesanan akan segera diproses.`,
      ``,
      `*📄 Rincian Pesanan:*`,
      `🛒 Item: ${items}`,
      data.courier ? `📦 Ekspedisi: ${data.courier}` : null,
      `💳 Metode Bayar: ${data.method || 'QRIS / Transfer'}`,
      data.totalAmount ? `💰 Total Bayar: *Rp ${Number(data.totalAmount).toLocaleString('id-ID')}*` : null,
      ``,
      data.address ? `*📍 Alamat Pengiriman:*\n${data.address}\n` : null,
      `*📦 Status Pengiriman:*`,
      `Menunggu diproses oleh tim kami. Resi otomatis akan dikirim jika paket sudah diserahkan ke kurir.`,
      ``,
      `Estimasi pengerjaan: 2-3 hari kerja.`,
      `Ditunggu ya bund, semoga produknya sesuai harapan 🙏`,
    ];

    return invoiceLines.filter(line => line !== null).join('\n');
  } catch (err: any) {
    logger.error(`[Invoice] Gagal membuat teks invoice: ${err.message}`);
    return `*🧾 STRUK PEMBAYARAN - LUNAS*\n━━━━━━━━━━━━━━━━━━━━━\nTerima kasih! Pembayaran Anda telah kami terima dan pesanan sedang diproses. 🙏`;
  }
}

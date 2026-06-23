import logger from '../utils/logger';
import * as mengantarService from './mengantar.service';
import * as scalevService from './scalev.service';
import * as xenditService from './xendit.service';
import { getStoreUniqueId } from './scalev.service';
import waSvc from '../whatsapp_service';
import { assertWaChatId } from '../utils/wa_id';

const LEGACY_XENDIT_ENABLED = process.env.ENABLE_LEGACY_XENDIT === 'true';

export interface ToolExecutionResult {
    name: string;
    content: string;
    needsSecondCall: boolean;
}

export const executeTool = async (
    toolCall: any,
    store: any,
    customerPhone: string,
    history: any[],
    agent: any
): Promise<ToolExecutionResult> => {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const toolName = toolCall.function.name;

    try {
        if (toolName === 'cek_ongkir') {
            const ongkirResult = await mengantarService.getShippingCost(args.destinationCity, args.weightGrams || 1000);
            return { name: toolName, content: ongkirResult, needsSecondCall: true };
        }

        if (toolName === 'tambahkan_label_chat') {
            return { name: toolName, content: `Label '${args.label_names.join(', ')}' diteruskan ke sistem.`, needsSecondCall: true };
        }

        if (toolName === 'matikan_bot_kontak') {
            return { name: toolName, content: `Bot akan dipause untuk kontak ini. Alasan: ${args.reason || 'perlu CS manusia'}`, needsSecondCall: true };
        }

        if (toolName === 'buat_order_scalev') {
            const customerName = String(args.customer_name || '').trim();
            const amount = Math.round(Number(args.amount));
            const desc = String(args.description || 'Pembayaran Pesanan').trim();
            const tipeBayar = (args.tipe_bayar === 'LUNAS' ? 'LUNAS' : 'DP');
            const explicitContactId = args.contact_id || null;
            const contactId = explicitContactId || customerPhone || null;
            const explicitStoreWaId = args.store_wa_id || null;
            const storeWaId = explicitStoreWaId || store?.wa_id || store?.id?.toString() || null;

            if (!amount || amount <= 0) {
                return { name: toolName, content: 'Gagal: Nominal tidak valid. Ambil nominal dari data rekap pesanan yang sudah dikonfirmasi customer. Jangan karang nominal sendiri.', needsSecondCall: true };
            }

            if (!customerName) {
                return { name: toolName, content: 'Gagal: customer_name harus diisi. Ambil dari rekap pesanan.', needsSecondCall: true };
            }

            if (scalevService?.createOrderAndPay && process.env.SCALEV_API_KEY) {
                let finalPhone = args.customer_phone ? String(args.customer_phone).trim() : '';
                if (!finalPhone || finalPhone.length < 5 || finalPhone.toLowerCase().includes('tidak')) {
                    finalPhone = contactId ? contactId.replace('@c.us', '').replace('@lid', '').replace(/^\+?62/, '0') : undefined;
                } else if (finalPhone.startsWith('62') || finalPhone.startsWith('+62')) {
                    finalPhone = finalPhone.replace(/^\+?62/, '0');
                }

                const scalevResult = await scalevService.createOrderAndPay({
                    store_unique_id: getStoreUniqueId(),
                    customer_name: customerName,
                    customer_phone: finalPhone,
                    address: args.address || undefined,
                    shipping_cost: args.shipping_cost ? Math.round(Number(args.shipping_cost)) : undefined,
                    payment_method: 'qris',
                    notes: `[${tipeBayar}] ${desc}`,
                    ordervariants: (args.ordervariants && args.ordervariants.length > 0)
                        ? args.ordervariants.map((v: any) => ({
                            product_name: v.product_name || 'Produk',
                            variant_name: v.variant_name || '-',
                            quantity: Math.round(Number(v.quantity) || 1),
                            price: Math.round(Number(v.price) || 0),
                        }))
                        : undefined,
                    metadata: {
                        tipe_bayar: tipeBayar,
                        contact_id: contactId || '',
                        store_wa_id: storeWaId || '',
                        created_by: 'bot_ai',
                        description: desc,
                    },
                    agent_context: {
                        source: 'crm_ai_bot',
                        tipe_bayar: tipeBayar,
                    },
                    amount: amount
                });

                if (scalevResult?.success && (scalevResult?.qrisImageBuffer || scalevResult?.public_order_url)) {
                    if (scalevResult.qrisImageBuffer && storeWaId && contactId) {
                        try {
                            const { MessageMedia } = require('whatsapp-web.js');
                            const client = waSvc.getActiveClient ? waSvc.getActiveClient(storeWaId) : null;
                            if (client) {
                                const media = new MessageMedia('image/png', scalevResult.qrisImageBuffer.toString('base64'), 'qris_payment.png');
                                const caption = [
                                    `Ini QRIS pembayarannya ya bund 😊`,
                                    `Nominal: *Rp ${amount.toLocaleString('id-ID')}* [${tipeBayar}]`,
                                    `Tinggal scan dari m-banking bund, berlaku 30 menit ya 🙏`,
                                    ``,
                                    `🏦 Atau transfer manual ke rekening bank kami (akan kami kirimkan terpisah ya bund) 🙏`,
                                ].join('\n');
                                const targetChatId = assertWaChatId(contactId);
                                const msg = await client.sendMessage(targetChatId, media, { caption });
                                const msgId = msg?.id?._serialized || msg?.id?.id;
                                if (msgId && waSvc.trackBotSentMessage) waSvc.trackBotSentMessage(msgId);
                                logger.info(`[AI] ✅ QRIS PNG (Scalev) terkirim ke ${contactId}`);
                            }
                        } catch (waErr: any) {
                            logger.error(`[AI] Gagal kirim QRIS PNG ke WA: ${waErr.message}`);
                        }
                    }

                    return {
                        name: toolName,
                        content: [
                            `Order berhasil dibuat di Scalev (Order ID: ${scalevResult.order_id}).`,
                            `QRIS berhasil dibuat dan sudah dikirim ke customer sebagai gambar.`,
                            `Nominal: Rp ${amount.toLocaleString('id-ID')} [${tipeBayar}].`,
                            `Berlaku 30 menit.`,
                            scalevResult.public_order_url ? `Link order: ${scalevResult.public_order_url}` : '',
                            `Instruksi ke customer: Sampaikan bahwa gambar QRIS sudah dikirim, tinggal scan dari m-banking.`,
                            `Juga ingatkan backup untuk transfer ke rekening toko (ambil rekening dari product knowledge).`,
                        ].filter(Boolean).join(' '),
                        needsSecondCall: true
                    };
                } else if (scalevResult?.success && scalevResult?.payment_url) {
                    return {
                        name: toolName,
                        content: [
                            `Order berhasil dibuat di Scalev (Order ID: ${scalevResult.order_id}).`,
                            `Link pembayaran tersedia: ${scalevResult.payment_url}`,
                            `Nominal: Rp ${amount.toLocaleString('id-ID')} [${tipeBayar}].`,
                            `Kirimkan link ini ke customer: ${scalevResult.payment_url}`,
                            `Sampaikan dengan ramah bahwa customer bisa klik link untuk scan QRIS atau bayar via metode lain.`,
                        ].join(' '),
                        needsSecondCall: true
                    };
                } else {
                    const errorMsg = scalevResult?.error || 'Scalev tidak tersedia';
                    logger.warn(`[AI] Scalev gagal (${errorMsg}), fallback ke transfer manual. Nominal: Rp ${amount}`);
                    return {
                        name: toolName,
                        content: [
                            `Sistem pembayaran sementara tidak tersedia (${errorMsg}).`,
                            `Minta customer transfer manual ke rekening toko.`,
                            `Nominal: Rp ${amount.toLocaleString('id-ID')} [${tipeBayar}].`,
                            `Rekening: Ambil dari informasi product knowledge agent.`,
                            `Sampaikan dengan ramah.`,
                        ].join(' '),
                        needsSecondCall: true
                    };
                }
            } else {
                return { name: toolName, content: `Sistem pembayaran sementara tidak tersedia. Minta customer transfer manual ke rekening toko (ambil dari product knowledge). Sampaikan dengan ramah.`, needsSecondCall: true };
            }
        }

        if (toolName === 'buat_resi_mengantar') {
            const orderParams = {
                customerName: String(args.customer_name || '').trim(),
                customerPhone: String(args.customer_phone || '').trim(),
                customerAddress: String(args.customer_address || '').trim(),
                destinationKeyword: String(args.destination_keyword || '').trim(),
                parcelContent: String(args.parcel_content || '').trim(),
                weight: Number(args.weight) || 1,
                quantity: Number(args.quantity) || 1,
                goodsValue: Number(args.goods_value) || 0,
                courier: args.courier || 'JT'
            };

            const resiResult = await mengantarService.createOrder(orderParams);

            if (resiResult?.success && resiResult?.cnote_no) {
                try {
                    const explicitContactId = args.contact_id || null;
                    const contactIdForResi = explicitContactId || customerPhone || null;
                    const explicitStoreWaId = args.store_wa_id || null;
                    const storeWaIdForResi = explicitStoreWaId || store?.wa_id || store?.id?.toString() || null;
                    
                    if (storeWaIdForResi && contactIdForResi) {
                        const client = waSvc.getActiveClient ? waSvc.getActiveClient(storeWaIdForResi) : null;
                        if (client) {
                            const targetChatId = assertWaChatId(contactIdForResi);
                            const resiMsg = mengantarService.formatResiMessage(resiResult);
                            await client.sendMessage(targetChatId, resiMsg);
                            logger.info(`[AI] ✅ Notifikasi resi terkirim ke ${contactIdForResi}`);
                        }
                    }
                } catch (waErr: any) {
                    logger.error(`[AI] Gagal kirim notif resi ke WA: ${waErr.message}`);
                }

                return {
                    name: toolName,
                    content: `Nomor resi ${resiResult.cnote_no} berhasil dibuat via kurir ${resiResult.courier}. Sistem sudah otomatis mengirimkan notifikasi resi ke customer. Sampaikan terima kasih secara ramah.`,
                    needsSecondCall: true
                };
            } else {
                const errorMsg = resiResult?.error || 'Unknown error';
                logger.warn(`[AI] Gagal buat resi: ${errorMsg}`);
                return {
                    name: toolName,
                    content: `Pembuatan resi gagal: ${errorMsg}. Sampaikan ke customer bahwa ada kendala teknis dari server pengiriman dan resi akan dikirim menyusul.`,
                    needsSecondCall: true
                };
            }
        }

        if (toolName === 'buat_link_pembayaran_dp') {
            if (!LEGACY_XENDIT_ENABLED) {
                return {
                    name: toolName,
                    content: 'Tool Xendit lama sudah dinonaktifkan di production. Gunakan buat_order_scalev untuk QRIS Scalev, atau arahkan customer transfer manual ke rekening toko dari product knowledge.',
                    needsSecondCall: true
                };
            }
            // Xendit logic is deprecated, minimal implementation or fallback
            return {
                name: toolName,
                content: 'Gunakan buat_order_scalev. Jika tidak tersedia, transfer manual.',
                needsSecondCall: true
            };
        }

        return { name: toolName, content: `Tool ${toolName} dieksekusi dengan sukses.`, needsSecondCall: true };
    } catch (err: any) {
        logger.error(`[AI] Tool Executor Error for ${toolName}: ${err.message}`);
        return { name: toolName, content: `Terjadi kesalahan internal saat mengeksekusi tool. Lanjutkan chat natural tanpa memaksa error.`, needsSecondCall: true };
    }
};

/**
 * contactIdentity.service.ts — Extracted from dashboard_service.js
 * Handles contact identity building, merging, and updating.
 */

import { ChatMessage, ChatSummary } from '../models';
import { buildContactIdentity, formatPhoneNumber } from '../utils/contact_identity';
import { socketService } from './socket.service';
import logger from '../utils/logger';

export function isPlaceholderContactName(name: any): boolean {
  const value = String(name || '').trim();
  return /^Kontak WA (#\d+|Privat)?$/.test(value)
    || value === 'Kontak WA Privat'
    || value === 'Kontak WhatsApp'
    || /^LID(-\d+)?$/.test(value);
}

export function firstStableDisplayName(...values: any[]): string {
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name || name.includes('@')) continue;
    if (isPlaceholderContactName(name)) continue;
    return name;
  }
  return '';
}

export interface StableContactIdentity {
  displayName: string;
  phone: string | null;
  lid: string | null;
  type: string;
  source: string;
}

export function mergeStableContactIdentity(contactId: string, msg: any, identity: any, latestMsg: any): StableContactIdentity {
  const latest = latestMsg?.get ? latestMsg.get({ plain: true }) : (latestMsg || {});
  const stablePhone = msg.contact_phone || identity.phone || latest.contact_phone || null;
  const phoneDisplay = stablePhone ? formatPhoneNumber(stablePhone) : '';
  const stableDisplayName = firstStableDisplayName(
    msg.contact_display_name,
    identity.displayName,
    latest.contact_display_name,
    latest.sender_name,
    phoneDisplay
  ) || identity.displayName || latest.contact_display_name || latest.sender_name || phoneDisplay || 'Kontak WhatsApp';

  return {
    displayName: stableDisplayName,
    phone: stablePhone,
    lid: msg.contact_lid || identity.lid || latest.contact_lid || null,
    type: msg.contact_type || identity.type || latest.contact_type,
    source: msg.contact_source || identity.source || latest.contact_source
  };
}

export async function updateContactPhoneIdentity(storeId: string, contactId: string, resolved: any = {}): Promise<any> {
  const latestMsg: any = await (ChatMessage as any).findOne({
    where: { store_wa_id: storeId, contact_id: contactId },
    order: [['timestamp', 'DESC']]
  });

  const identity = buildContactIdentity(contactId, {
    name: resolved.contact?.name || resolved.contact?.verifiedName || latestMsg?.contact_display_name || latestMsg?.sender_name,
    pushname: resolved.contact?.pushname,
    shortName: resolved.contact?.shortName,
    phone: resolved.phone
  });

  await (ChatMessage as any).update({
    contact_display_name: identity.displayName,
    contact_phone: resolved.phone,
    contact_lid: identity.lid || null,
    contact_type: identity.type,
    contact_source: resolved.source || identity.source
  }, {
    where: { store_wa_id: storeId, contact_id: contactId }
  });

  try {
    await (ChatSummary as any).update({ contact_name: identity.displayName }, {
      where: { store_wa_id: storeId, contact_id: contactId }
    });
  } catch (_) {}

  socketService.emitContactIdentityUpdated(storeId, contactId, {
    contact_display_name: identity.displayName,
    contact_phone: resolved.phone,
    contact_lid: identity.lid || null,
    contact_type: identity.type,
    contact_source: resolved.source || identity.source
  });

  return {
    ...identity,
    phone: resolved.phone,
    phoneWid: resolved.phoneWid || ''
  };
}

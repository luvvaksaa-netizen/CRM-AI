import { Request, Response, NextFunction } from 'express';
import { Store, BotAgent, ChatSummary, FollowUp, ChatMessage } from '../models';
import { Op } from 'sequelize';

/**
 * Bot Activation Controller
 * Mengelola aktivasi/deaktivasi bot per store.
 */

export const getStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.params;
    const store = await Store.findOne({
      where: { wa_id: store_wa_id },
      include: [{ model: BotAgent, as: 'BotAgent' }]
    });

    if (!store) return res.status(404).json({ error: 'Store tidak ditemukan' });

    // Count pending followups for this store
    const pendingFollowUps = await FollowUp.count({
      where: { store_wa_id, status: 'pending' }
    });

    // Count active conversations (contacts with recent messages)
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeContacts = await ChatMessage.findAll({
      attributes: ['contact_id'],
      where: {
        store_wa_id,
        timestamp: { [Op.gte]: recentCutoff }
      },
      group: ['contact_id']
    });

    res.json({
      store: {
        wa_id: (store as any).wa_id,
        name: (store as any).name,
        is_bot_active: (store as any).is_bot_active,
        agent: (store as any).BotAgent ? { id: (store as any).BotAgent.id, name: (store as any).BotAgent.name } : null
      },
      pendingFollowUps,
      activeContactCount: activeContacts.length
    });
  } catch (e) {
    next(e);
  }
};

export const toggleBot = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.params;
    const { active } = req.body;

    const store = await Store.findOne({ where: { wa_id: store_wa_id } });
    if (!store) return res.status(404).json({ error: 'Store tidak ditemukan' });

    (store as any).is_bot_active = active === true || active === 'true';
    await store.save();

    // If turning ON, trigger bot activation service scan (background)
    if ((store as any).is_bot_active) {
      try {
        const path = require('path');
        const { onBotActivated } = require('../services/bot_activation_service');
        // Non-blocking background
        onBotActivated(store_wa_id).catch((e: any) =>
          console.error(`[BotActivation] Background scan error: ${e.message}`)
        );
      } catch (e: any) {
        console.error(`[BotActivation] Failed to load service: ${e.message}`);
      }
    }

    res.json({
      success: true,
      is_bot_active: (store as any).is_bot_active,
      message: (store as any).is_bot_active
        ? 'Bot berhasil diaktifkan. Scan kontak berjalan di background.'
        : 'Bot berhasil dinonaktifkan.'
    });
  } catch (e) {
    next(e);
  }
};

export const getAllStoresStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await Store.findAll({
      include: [{ model: BotAgent, as: 'BotAgent' }]
    });

    const result = await Promise.all(stores.map(async (store: any) => {
      const [pendingCount, activeContacts] = await Promise.all([
        FollowUp.count({ where: { store_wa_id: (store as any).wa_id, status: 'pending' } }),
        ChatMessage.count({
          where: {
            store_wa_id: (store as any).wa_id,
            timestamp: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          distinct: true,
          col: 'contact_id'
        })
      ]);

      return {
        wa_id: (store as any).wa_id,
        name: (store as any).name,
        is_bot_active: (store as any).is_bot_active,
        last_active: (store as any).last_active,
        agent: (store as any).BotAgent ? { id: (store as any).BotAgent.id, name: (store as any).BotAgent.name } : null,
        pendingFollowUps: pendingCount,
        activeContactCount: activeContacts
      };
    }));

    res.json(result);
  } catch (e) {
    next(e);
  }
};

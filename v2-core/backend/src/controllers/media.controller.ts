import { Request, Response, NextFunction } from 'express';
import { MediaAsset, BotAgent } from '../models';
import fs from 'fs';
import path from 'path';

export const getMediaAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: any = {};
    if (req.query.agent_id) where.agent_id = req.query.agent_id;
    const assets = await MediaAsset.findAll({
      where,
      order: [['id', 'DESC']],
      include: [{ model: BotAgent, attributes: ['id', 'name', 'bot_name'] }]
    });
    res.json(assets);
  } catch (e) {
    next(e);
  }
};

export const getMediaById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const asset = await MediaAsset.findByPk(id, {
      include: [{ model: BotAgent, attributes: ['id', 'name', 'bot_name'] }]
    }) as any;
    if (!asset) return res.status(404).json({ success: false, message: 'Media tidak ditemukan' });
    res.json(asset);
  } catch (e) {
    next(e);
  }
};

export const uploadMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Tidak ada file diupload' });
    }
    
    const { label, description, trigger_words, purpose, agent_id } = req.body;
    const isVideo = req.file.mimetype.startsWith('video');

    const asset = await MediaAsset.create({
      filename: req.file.filename,
      original_name: req.file.originalname,
      type: isVideo ? 'video' : 'image',
      label: label || 'Untitled',
      description: description || '',
      trigger_words: trigger_words || '',
      purpose: purpose || 'both',
      agent_id: agent_id || null
    } as any);

    // Fetch with agent relation
    const fullAsset = await MediaAsset.findByPk((asset as any).id, {
      include: [{ model: BotAgent, attributes: ['id', 'name', 'bot_name'] }]
    });

    // Hook: Daftarkan ke mediaService untuk AI analysis (vision + video)
    try {
      const mediaService = require('../services/media.service');
      const MEDIA_UPLOADS_DIR = process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR, 'uploads')
        : path.resolve(__dirname, '../../data/uploads');
      const filePath = path.resolve(MEDIA_UPLOADS_DIR, path.basename(req.file.filename));
      await mediaService.registerMedia({
        agent_id: agent_id || null,
        filename: req.file.filename,
        original_name: req.file.originalname,
        type: isVideo ? 'video' : 'image',
        label: label || 'Untitled',
        description: description || '',
        purpose: purpose || 'both',
        filePath: filePath
      });
      console.log(`[Media] Registered for AI analysis: ${req.file.filename}`);
    } catch (mediaErr: any) {
      console.error(`[Media] registerMedia hook failed: ${mediaErr.message}`);
      // Non-blocking — media tetap tersimpan
    }

    res.json({ success: true, asset: fullAsset });
  } catch (e) {
    next(e);
  }
};

export const updateMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const asset = await MediaAsset.findByPk(id) as any;
    if (!asset) return res.status(404).json({ success: false, message: 'Media tidak ditemukan' });

    const { label, description, trigger_words, purpose, agent_id } = req.body;
    const updates: any = {};
    if (label !== undefined) updates.label = label;
    if (description !== undefined) updates.description = description;
    if (trigger_words !== undefined) updates.trigger_words = trigger_words;
    if (purpose !== undefined) updates.purpose = purpose;
    if (agent_id !== undefined) updates.agent_id = agent_id || null;

    await asset.update(updates);

    const updated = await MediaAsset.findByPk(id, {
      include: [{ model: BotAgent, attributes: ['id', 'name', 'bot_name'] }]
    });

    res.json({ success: true, asset: updated });
  } catch (e) {
    next(e);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const asset = await MediaAsset.findByPk(id) as any;
    
    if (!asset) return res.status(404).json({ success: false, message: 'Media tidak ditemukan' });

    // Delete file
    const UPLOADS_DIR = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR, 'uploads')
      : path.resolve(__dirname, '../../data/uploads');
    const filePath = path.join(UPLOADS_DIR, path.basename(asset.filename));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await asset.destroy();
    res.json({ success: true, message: 'Media dihapus' });
  } catch (e) {
    next(e);
  }
};

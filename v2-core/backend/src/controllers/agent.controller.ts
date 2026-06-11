import { Request, Response, NextFunction } from 'express';
import { BotAgent, Store, MediaAsset } from '../models';
import { deleteMedia } from '../services/media.service'; // fallback to legacy service

export const getAgents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = await BotAgent.findAll({ order: [['id', 'ASC']] });
    res.json(agents);
  } catch (e) {
    next(e);
  }
};

export const createAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, bot_name, system_prompt, product_knowledge, auto_labels } = req.body;
    const newAgent = await BotAgent.create({
      name: name || 'Agen Baru',
      bot_name: bot_name || 'CS Bot',
      system_prompt: system_prompt || 'Kamu adalah CS yang ramah.',
      product_knowledge: product_knowledge || '',
      auto_labels: auto_labels || ''
    } as any);
    res.json({ success: true, agent: newAgent });
  } catch (e) {
    next(e);
  }
};

export const updateAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, bot_name, system_prompt, product_knowledge, auto_labels } = req.body;
    const agent = await BotAgent.findByPk(req.params.id as any);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });
    await agent.update({ name, bot_name, system_prompt, product_knowledge, auto_labels } as any);
    res.json({ success: true, agent });
  } catch (e) {
    next(e);
  }
};

export const deleteAgent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agentId = req.params.id as any;
    const agent = await BotAgent.findByPk(agentId);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });

    await Store.update({ agent_id: null }, { where: { agent_id: agentId } });

    const mediaAssets: any[] = await MediaAsset.findAll({ where: { agent_id: agentId } });
    for (const asset of mediaAssets) {
      await deleteMedia(asset.id, agentId);
    }

    await agent.destroy();
    res.json({ success: true, message: 'Agen berhasil dihapus.' });
  } catch (e) {
    next(e);
  }
};

/** Get media assets belonging to a specific agent */
export const getAgentMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agentId = req.params.id as any;
    const agent = await BotAgent.findByPk(agentId);
    if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });

    const media = await MediaAsset.findAll({
      where: { agent_id: agentId },
      order: [['id', 'DESC']],
      include: [{ model: BotAgent, attributes: ['id', 'name', 'bot_name'] }]
    });
    res.json({ agent: { id: (agent as any).id, name: (agent as any).name }, media, count: media.length });
  } catch (e) {
    next(e);
  }
};

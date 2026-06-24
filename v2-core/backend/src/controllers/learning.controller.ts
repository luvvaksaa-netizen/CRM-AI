import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ClosingPattern, ClosingAnalytic, BotAgent } from '../models';

/**
 * Learning Center Controller
 * Menampilkan pola pembelajaran AI, analitik closing, dan top patterns.
 */

export const getOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id } = req.query;
    const patternWhere: any = { is_active: true };
    if (agent_id) patternWhere.agent_id = agent_id;

    const analyticWhere: any = {};
    if (agent_id) analyticWhere.agent_id = agent_id;

    const [totalPatterns, activePatterns, totalAnalytics, qualifiedAnalytics] = await Promise.all([
      ClosingPattern.count({ where: agent_id ? { agent_id } : {} }),
      ClosingPattern.count({ where: patternWhere }),
      ClosingAnalytic.count({ where: analyticWhere }),
      ClosingAnalytic.count({ where: { ...analyticWhere, conversation_score: { [Op.gte]: 6.0 } } })
    ]);

    // Top patterns by confidence
    const topPatterns = await ClosingPattern.findAll({
      where: patternWhere,
      order: [['confidence', 'DESC'], ['frequency', 'DESC']],
      limit: 10
    });

    // Recent analytics
    const recentAnalytics = await ClosingAnalytic.findAll({
      where: analyticWhere,
      order: [['analyzed_at', 'DESC']],
      limit: 10
    });

    // Agents with most patterns
    const agents = await BotAgent.findAll({ attributes: ['id', 'name'] });
    const agentStats = [];
    for (const agent of agents) {
      const count = await ClosingPattern.count({ where: { agent_id: (agent as any).id, is_active: true } });
      if (count > 0) agentStats.push({ id: (agent as any).id, name: (agent as any).name, patternCount: count });
    }

    res.json({
      totalPatterns,
      activePatterns,
      totalAnalytics,
      qualifiedAnalytics,
      topPatterns,
      recentAnalytics,
      agentStats
    });
  } catch (e) {
    next(e);
  }
};

export const getPatterns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id, product_type, source_type, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 30));

    const where: any = {};
    if (agent_id) where.agent_id = agent_id;
    if (product_type && product_type !== 'semua') where.product_type = product_type;
    if (source_type && source_type !== 'semua') where.source_type = source_type;

    const total = await ClosingPattern.count({ where });
    const data = await ClosingPattern.findAll({
      where,
      order: [['confidence', 'DESC'], ['frequency', 'DESC'], ['last_seen_at', 'DESC']],
      offset: (pageNum - 1) * limitNum,
      limit: limitNum
    });

    res.json({ data, total, page: pageNum, totalPages: Math.ceil(total / limitNum) || 1 });
  } catch (e) {
    next(e);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 30));

    const where: any = {};
    if (agent_id) where.agent_id = agent_id;

    const total = await ClosingAnalytic.count({ where });
    const data = await ClosingAnalytic.findAll({
      where,
      order: [['analyzed_at', 'DESC']],
      offset: (pageNum - 1) * limitNum,
      limit: limitNum
    });

    res.json({ data, total, page: pageNum, totalPages: Math.ceil(total / limitNum) || 1 });
  } catch (e) {
    next(e);
  }
};

export const togglePattern = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pattern = await ClosingPattern.findByPk(req.params.id as any);
    if (!pattern) return res.status(404).json({ error: 'Pattern tidak ditemukan' });

    (pattern as any).is_active = !(pattern as any).is_active;
    await pattern.save();
    res.json({ success: true, pattern });
  } catch (e) {
    next(e);
  }
}

export const seedLearning = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id, product_type, teknik, contoh_kalimat, konteks, dampak, confidence } = req.body;

    if (!teknik || !contoh_kalimat) {
      return res.status(400).json({ error: 'Teknik dan contoh_kalimat wajib diisi.' });
    }

    const pattern = await ClosingPattern.create({
      agent_id: agent_id || null,
      product_type: product_type || 'generic',
      teknik,
      contoh_kalimat,
      konteks: konteks || '',
      dampak: dampak || '',
      frequency: 1,
      confidence: confidence || 0.7,
      is_active: true,
      source_type: 'manual',
      last_seen_at: new Date()
    } as any);

    res.json({ success: true, pattern });
  } catch (e) {
    next(e);
  }
};

export const deletePattern = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pattern = await ClosingPattern.findByPk(req.params.id as any);
    if (!pattern) return res.status(404).json({ error: 'Pattern tidak ditemukan' });

    await pattern.destroy();
    res.json({ success: true, message: 'Pattern berhasil dihapus.' });
  } catch (e) {
    next(e);
  }
};


import { PromptEvolutionLog } from '../models';

/**
 * Mengambil riwayat evolusi prompt dari PromptEvolutionLog.
 * Ini adalah data aktual dari Prompt Revision Engine — berisi before/after diff, summary perubahan.
 */
export const getPromptEvolutions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id, date } = req.query;
    const where: any = {};
    if (agent_id) where.agent_id = agent_id;
    if (date) {
      const startDate = new Date(date as string);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date as string);
      endDate.setHours(23, 59, 59, 999);
      where.created_at = { [Op.between]: [startDate, endDate] };
    }

    const logs = await PromptEvolutionLog.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: 50,
      include: [{ model: BotAgent, as: 'BotAgent', attributes: ['name', 'bot_name'] }]
    });

    const data = logs.map((log: any) => ({
      id: log.id,
      agent_id: log.agent_id,
      agent_name: log.BotAgent?.name || log.BotAgent?.bot_name || 'Agent',
      prompt_before: log.prompt_before,
      prompt_after: log.prompt_after,
      summary_changes: log.summary_changes,
      patterns_used: log.patterns_used,
      tokens_used: log.tokens_used,
      created_at: log.created_at
    }));

    res.json({ data, total: data.length });
  } catch (e) {
    next(e);
  }
};

/**
 * Mengambil current learned_prompt_addon untuk sebuah agent.
 * Digunakan UI untuk preview apa yang sedang di-inject ke prompt bot.
 */
export const getLearnedPromptAddon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id } = req.params;
    if (!agent_id) return res.status(400).json({ error: 'agent_id diperlukan' });

    const agentIdNum = parseInt(agent_id as string, 10);
    if (isNaN(agentIdNum)) return res.status(400).json({ error: 'agent_id tidak valid' });

    const agent = await BotAgent.findByPk(agentIdNum, {
      attributes: ['id', 'name', 'bot_name', 'system_prompt', 'learned_prompt_addon']
    });

    if (!agent) return res.status(404).json({ error: 'Agent tidak ditemukan' });

    res.json({
      agent_id: (agent as any).id,
      agent_name: (agent as any).name || (agent as any).bot_name,
      learned_prompt_addon: (agent as any).learned_prompt_addon || null,
      system_prompt_preview: ((agent as any).system_prompt || '').slice(0, 300) + '...'
    });
  } catch (e) {
    next(e);
  }
};


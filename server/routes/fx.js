import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { getFxRate, supportedCurrencies } from '../lib/fx.js';

const router = Router();
router.use(requireAuth);

router.get('/currencies', (_req, res) => {
  res.json(supportedCurrencies());
});

router.get('/rate', async (req, res) => {
  const base = String(req.query.base || '').toUpperCase();
  const quote = String(req.query.quote || '').toUpperCase();
  const date = String(req.query.date || 'latest');
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) {
    return res.status(400).json({ error: 'base and quote must be 3-letter currency codes' });
  }
  const rate = await getFxRate(base, quote, date);
  res.json({ base, quote, date, rate });
});

export default router;

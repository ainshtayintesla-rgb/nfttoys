import { Router } from 'express';

import balanceRouter from './routes/balance';
import pinRouter from './routes/pin';
import sessionsRouter from './routes/sessions';
import stakingRouter from './routes/staking';
import storyShareRouter from './routes/storyShare';
import transactionsRouter from './routes/transactions';
import walletsRouter from './routes/wallets';

const router = Router();

router.use(walletsRouter);
router.use(pinRouter);
router.use(sessionsRouter);
router.use(balanceRouter);
router.use(stakingRouter);
router.use(storyShareRouter);
router.use(transactionsRouter);

export default router;

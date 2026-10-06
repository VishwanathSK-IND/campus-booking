import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { requireAuth } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';
import { loginSchema, registerSchema } from '../validators/authValidators.js';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), auth.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), auth.login);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);

export default router;

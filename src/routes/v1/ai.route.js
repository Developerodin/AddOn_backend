import express from 'express';
import auth from '../../middlewares/auth.js';
import streamChat from '../../ai/chat.service.js';

const router = express.Router();

router.post('/chat', auth(), (req, res, next) => {
  streamChat(req, res).catch((err) => {
    next(err);
  });
});

export default router;

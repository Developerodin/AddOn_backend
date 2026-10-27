import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as taskValidation from '../../validations/task.validation.js';
import * as taskController from '../../controllers/task.controller.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), validate(taskValidation.createTask), taskController.createTask)
  .get(auth(), validate(taskValidation.getTasks), taskController.getTasks);

router
  .route('/notifications')
  .get(auth(), validate(taskValidation.getNotifications), taskController.getNotifications);

router
  .route('/notifications/read')
  .post(auth(), validate(taskValidation.markNotificationsRead), taskController.markNotificationsRead);

router
  .route('/:taskId')
  .get(auth(), validate(taskValidation.getTask), taskController.getTask)
  .patch(auth(), validate(taskValidation.updateTask), taskController.updateTask);

router
  .route('/:taskId/timeline')
  .post(auth(), validate(taskValidation.addTimeline), taskController.addTimeline);

export default router;

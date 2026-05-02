import Joi from 'joi';

export const getYarnReportSnapshotBounds = {
  query: Joi.object().unknown(false),
};

/** Match calendar keys used by YarnDailyClosingSnapshot (avoid Joi Date coercion / UTC drift). */
const isoCalendarDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

export const getYarnReport = {
  query: Joi.object()
    .keys({
      start_date: isoCalendarDate.required(),
      end_date: isoCalendarDate.required(),
    })
    .custom((value, helpers) => {
      if (value.end_date < value.start_date) {
        return helpers.error('any.custom', { message: 'end_date must be >= start_date' });
      }
      return value;
    }, 'date range validation'),
};

export const getPoShortTermStorageReport = {
  params: Joi.object().keys({
    poNumber: Joi.string().trim().min(1).required(),
  }),
};

export const getPoBoxAuditReport = {
  params: Joi.object().keys({
    poNumber: Joi.string().trim().min(1).required(),
  }),
};

import Joi from 'joi';

export const getYarnReport = {
  query: Joi.object()
    .keys({
      start_date: Joi.date().iso().required(),
      end_date: Joi.date().iso().required(),
    })
    .custom((value, helpers) => {
      const start = new Date(value.start_date);
      const end = new Date(value.end_date);
      if (end < start) {
        return helpers.error('any.custom', { message: 'end_date must be >= start_date' });
      }
      return value;
    }, 'date range validation'),
};

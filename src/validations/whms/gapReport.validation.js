import Joi from 'joi';

export const getGapReport = {
  query: Joi.object().keys({
    warehouse: Joi.string().allow(''),
    date: Joi.date(),
    styleCode: Joi.string().allow(''),
  }),
};

const requirementItem = Joi.object({
  styleCode: Joi.string().required(),
  itemName: Joi.string().allow(''),
  shortage: Joi.number().min(0).required(),
  requestedQty: Joi.number().min(0),
});

export const sendRequirement = {
  body: Joi.alternatives().try(
    requirementItem,
    Joi.array().items(requirementItem).min(1)
  ),
};

/**
 * Input validation schemas using Joi
 */

const Joi = require('joi');

const schemas = {
  vote: Joi.object({
    userId: Joi.string().required().min(1).max(255),
    itemId: Joi.string().uuid().required(),
    voteValue: Joi.number().integer().min(-1).max(1).default(1)
  }),

  user: Joi.object({
    username: Joi.string().alphanum().required().min(3).max(30),
    email: Joi.string().email().required(),
    password: Joi.string().min(8)
  }),

  item: Joi.object({
    title: Joi.string().required().min(3).max(255),
    description: Joi.string().max(1000)
  }),

  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(10),
    offset: Joi.number().integer().min(0).default(0)
  })
};

const validate = (data, schema) => {
  const { error, value } = schema.validate(data, { 
    abortEarly: false,
    stripUnknown: true 
  });

  if (error) {
    const messages = error.details.map(d => d.message).join(', ');
    throw new Error(`Validation error: ${messages}`);
  }

  return value;
};

module.exports = { schemas, validate };

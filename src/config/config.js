import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';
import { parseMongoRetryWrites, setRetryWritesOnUri } from './mongoUri.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('MongoDB URL'),
    MONGODB_RETRY_WRITES: Joi.string()
      .valid('true', 'false')
      .default('false')
      .description('Enable MongoDB retryable writes (false for standalone deployments)'),
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number().default(30).description('days after which refresh tokens expire'),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which reset password token expires'),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which verify email token expires'),
    SMTP_HOST: Joi.string().description('server that will send the emails'),
    SMTP_PORT: Joi.number().description('port to connect to the email server'),
    SMTP_USERNAME: Joi.string().description('username for email server'),
    SMTP_PASSWORD: Joi.string().description('password for email server'),
    EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
    AWS_ACCESS_KEY_ID: Joi.string().required().description('AWS access key ID'),
    AWS_SECRET_ACCESS_KEY: Joi.string().required().description('AWS secret access key'),
    AWS_REGION: Joi.string().required().description('AWS region'),
    AWS_BUCKET_NAME: Joi.string().required().description('AWS S3 bucket name'),
    OPENAI_API_KEY: Joi.string().required().description('OpenAI API key'),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw Error(`Config validation error: ${error.message}`);
}

const mongoRetryWrites = parseMongoRetryWrites(envVars.MONGODB_RETRY_WRITES);
const mongoBaseUrl = envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : '');

const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: setRetryWritesOnUri(mongoBaseUrl, mongoRetryWrites),
    options: {
      useCreateIndex: true, // Optional: Remove this if using Mongoose v6+
      useNewUrlParser: true,
      useUnifiedTopology: true,
      retryWrites: mongoRetryWrites,
    },
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  email: {
    smtp: {
      host: envVars.SMTP_HOST,
      port: envVars.SMTP_PORT,
      auth: {
        user: envVars.SMTP_USERNAME,
        pass: envVars.SMTP_PASSWORD,
      },
    },
    from: envVars.EMAIL_FROM,
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    s3: {
      bucket: process.env.AWS_BUCKET_NAME,
    }
  },
  openai: {
    apiKey: envVars.OPENAI_API_KEY,
  },
};

export default config;

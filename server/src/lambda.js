import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';
import { connect } from './db.js';

/**
 * Lambda entry point.
 *
 * Everything here runs once per *container*, not once per request — Lambda
 * keeps a warm instance alive between invocations, so the Fastify app and the
 * DynamoDB client are built at module scope and reused. Building them inside
 * the handler would rebuild the whole app on every call.
 *
 * The index is not created here; `npm run setup` does that once. See db.js.
 */
const region = process.env.AWS_REGION ?? 'us-east-1';
await connect(process.env.DYNAMODB_TABLE, region);

const app = await buildApp();

export const handler = awsLambdaFastify(app, {
  // Function URLs deliver a payload shaped like API Gateway v2.
  payloadAsStream: false,
});

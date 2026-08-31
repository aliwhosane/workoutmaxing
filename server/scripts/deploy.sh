#!/usr/bin/env bash
# Packages and deploys the sync service to AWS Lambda.
#
# First run creates the function; later runs update its code. Idempotent, so
# running it twice is safe.
#
#   ./scripts/deploy.sh
#
# Requires the AWS CLI, configured with credentials that may create Lambda
# functions and IAM roles. Reads JWT_SECRET, APPLE_CLIENT_ID and
# GOOGLE_CLIENT_ID from the environment — source your .env first.
set -euo pipefail

FUNCTION="${FUNCTION:-workout-maxing-sync}"
REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE:-workout_maxxing}"
ROLE_NAME="${FUNCTION}-role"

cd "$(dirname "$0")/.."

: "${JWT_SECRET:?set JWT_SECRET — generate a fresh one for production}"

echo "==> installing production dependencies"
rm -rf .deploy function.zip && mkdir -p .deploy
cp -r src package.json .deploy/
(cd .deploy && npm install --omit=dev --no-audit --no-fund --silent)

echo "==> packaging"
(cd .deploy && zip -qr ../function.zip .)
echo "    $(du -h function.zip | cut -f1)"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> creating execution role"
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  # Only what the running service needs. It cannot alter the table: the index is
  # created once by `npm run setup`, never by the server.
  aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name dynamodb-access \
    --policy-document "{
      \"Version\":\"2012-10-17\",
      \"Statement\":[{
        \"Effect\":\"Allow\",
        \"Action\":[\"dynamodb:Query\",\"dynamodb:GetItem\",\"dynamodb:UpdateItem\",\"dynamodb:BatchWriteItem\"],
        \"Resource\":[
          \"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}\",
          \"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}/index/*\"
        ]
      }]
    }"
  echo "    waiting for the role to propagate"
  sleep 12
fi

ENV_VARS="Variables={DYNAMODB_TABLE=${TABLE},JWT_SECRET=${JWT_SECRET},APPLE_CLIENT_ID=${APPLE_CLIENT_ID:-},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}}"

if aws lambda get-function --function-name "$FUNCTION" --region "$REGION" >/dev/null 2>&1; then
  echo "==> updating code"
  aws lambda update-function-code --function-name "$FUNCTION" --region "$REGION" \
    --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FUNCTION" --region "$REGION" \
    --environment "$ENV_VARS" >/dev/null
else
  echo "==> creating function"
  aws lambda create-function --function-name "$FUNCTION" --region "$REGION" \
    --runtime nodejs22.x --handler src/lambda.handler --role "$ROLE_ARN" \
    --timeout 30 --memory-size 512 \
    --zip-file fileb://function.zip --environment "$ENV_VARS" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION" --region "$REGION"

  echo "==> creating public HTTPS endpoint"
  aws lambda create-function-url-config --function-name "$FUNCTION" --region "$REGION" \
    --auth-type NONE >/dev/null
  # Public because the app authenticates with its own bearer token; IAM auth
  # would mean signing requests from the phone with AWS credentials.
  aws lambda add-permission --function-name "$FUNCTION" --region "$REGION" \
    --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null
fi

URL=$(aws lambda get-function-url-config --function-name "$FUNCTION" --region "$REGION" --query FunctionUrl --output text)
rm -rf .deploy function.zip

echo
echo "deployed: ${URL}"
echo "put that in API_BASE_URL (without the trailing slash) in mobile/eas.json"

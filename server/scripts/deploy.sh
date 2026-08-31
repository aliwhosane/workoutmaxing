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
API_NAME="${API_NAME:-workout-maxing}"

cd "$(dirname "$0")/.."

# The session secret is generated once and then lives in the function's own
# configuration. Reusing it on redeploy matters: changing it invalidates every
# session token, so a routine code push would otherwise sign every user out.
if [ -z "${JWT_SECRET:-}" ]; then
  EXISTING=$(aws lambda get-function-configuration --function-name "$FUNCTION" \
    --region "$REGION" --query 'Environment.Variables.JWT_SECRET' --output text 2>/dev/null || true)
  if [ -n "${EXISTING:-}" ] && [ "$EXISTING" != "None" ] && [ "$EXISTING" != "null" ]; then
    JWT_SECRET="$EXISTING"
    echo "==> reusing the deployed session secret"
  else
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
    echo "==> generated a new session secret (kept in the function's config)"
  fi
fi

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

fi

# An HTTP API rather than a Lambda Function URL. Function URLs are free where
# they work, but newer AWS accounts block public access to them at the account
# level, and the block is not visible from the CLI — the URL simply answers
# Forbidden with a resource policy that is provably correct. An HTTP API costs
# about $1 per million requests after the first year, which is cents here, and
# it works everywhere.
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text 2>/dev/null || true)

if [ -z "${API_ID:-}" ] || [ "$API_ID" = "None" ]; then
  echo "==> creating HTTPS endpoint"
  FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION" --region "$REGION" \
    --query 'Configuration.FunctionArn' --output text)
  API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP \
    --target "$FUNCTION_ARN" --region "$REGION" --query ApiId --output text)
  aws lambda add-permission --function-name "$FUNCTION" --region "$REGION" \
    --statement-id apigw-invoke --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*" >/dev/null
  sleep 8
fi

URL=$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query ApiEndpoint --output text)
rm -rf .deploy function.zip

echo
echo "deployed: ${URL}"
echo "already set as API_BASE_URL in mobile/eas.json"

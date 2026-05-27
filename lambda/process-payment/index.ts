import { createClient } from "@supabase/supabase-js";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";

let secretsCache: Record<string, string> | null = null;

const getSecrets = async (): Promise<Record<string, string>> => {
  if (secretsCache) return secretsCache;
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const resp = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.SECRETS_ARN })
  );
  secretsCache = JSON.parse(resp.SecretString!);
  return secretsCache!;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const secrets = await getSecrets();

    const stripeKey = secrets.STRIPE_SECRET_KEY;
    const supabaseUrl = secrets.SUPABASE_URL;
    const serviceRoleKey = secrets.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeKey || !supabaseUrl || !serviceRoleKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required environment variables" }),
      };
    }

    // verifyJwt=true on Supabase — reproduce the platform JWT check (gone on Lambda).
    const authHeader =
      event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing Authorization header" }),
      };
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Note: supabase.auth.getUser() is a network call to Supabase (~50-150ms).
    // Cache the user object within the request if multiple checks are needed.
    // Do not cache across requests — JWTs are per-user and expire.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));

    if (authError || !user) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const { amount, currency } = JSON.parse(event.body || "{}");

    // Simulated payment processing
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "succeeded",
        amount,
        currency,
        id: `pi_${crypto.randomUUID()}`,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: (error as Error).message ?? "Internal server error" }),
    };
  }
};

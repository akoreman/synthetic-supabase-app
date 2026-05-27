import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createClient } from "@supabase/supabase-js";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let secretsCache: Record<string, string> | null = null;
const getSecrets = async () => {
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

    const secrets = await getSecrets();
    const supabase = createClient(
      secrets.SUPABASE_URL,
      secrets.SUPABASE_ANON_KEY
    );

    // Note: supabase.auth.getUser() is a network call to Supabase (~50-150ms). Cache the user
    // object within the request if multiple checks are needed. Do not cache across requests —
    // JWTs are per-user and expire.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, "")
    );
    if (authError || !user) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello from Supabase Edge Functions!" }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(error) }),
    };
  }
};

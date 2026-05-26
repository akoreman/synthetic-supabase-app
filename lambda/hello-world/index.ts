import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Secrets Manager cache (module-level, reused across warm invocations)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // -----------------------------------------------------------------------
    // JWT validation — reproduces Supabase platform verifyJwt=true behaviour
    // (that platform check is absent on Lambda; we must do it explicitly)
    // -----------------------------------------------------------------------
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

    // verifyJwt=true on Supabase — reproduce the platform JWT check (gone on Lambda).
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

    // -----------------------------------------------------------------------
    // Business logic (original: return a static greeting)
    // -----------------------------------------------------------------------
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello from Supabase Edge Functions!" }),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error }),
    };
  }
};

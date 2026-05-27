import { APIGatewayProxyEvent, APIGatewayProxyResult } from "@types/aws-lambda";
import { createClient } from "@supabase/supabase-js";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// ---------------------------------------------------------------------------
// Secrets cache (per Lambda container lifetime — NOT across requests)
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
// Handler
// ---------------------------------------------------------------------------
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // ------------------------------------------------------------------
    // JWT validation — reproduces the verifyJwt=true platform check that
    // Supabase performed before dispatching the original edge function.
    // Without this check the Lambda endpoint would be publicly accessible.
    // ------------------------------------------------------------------
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

    // Service-role client — bypasses RLS for admin-level operations (matches
    // original function intent). A separate auth.getUser() call is used ONLY
    // to validate the caller JWT, not to scope DB access.
    const supabase = createClient(
      secrets.SUPABASE_URL,
      secrets.SUPABASE_SERVICE_ROLE_KEY
    );

    // verifyJwt=true on Supabase — reproduce the platform JWT check (gone on Lambda).
    // Note: supabase.auth.getUser() is a network call to Supabase (~50-150ms). Cache
    // the user object within the request if multiple checks are needed. Do not cache
    // across requests — JWTs are per-user and expire.
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

    // ------------------------------------------------------------------
    // Validate required secrets (mirrors original env-var guard)
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Parse request body
    // ------------------------------------------------------------------
    const { amount, currency } = JSON.parse(event.body || "{}");

    // ------------------------------------------------------------------
    // Simulated payment processing (original business logic preserved)
    // ------------------------------------------------------------------
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
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error }),
    };
  }
};

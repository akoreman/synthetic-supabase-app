import { APIGatewayProxyEvent, APIGatewayProxyResult } from "@types/aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Secrets Manager — cached per Lambda container lifetime
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

    // -----------------------------------------------------------------------
    // JWT validation — verifyJwt=true on Supabase means the platform validated
    // caller JWTs before dispatch. That platform check is GONE on Lambda;
    // reproduce it explicitly using the service-role client's auth.getUser().
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Note: supabase.auth.getUser() is a network call to Supabase (~50-150ms).
    // Cache the user object within the request if multiple checks are needed.
    // Do not cache across requests — JWTs are per-user and expire.
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
    // Business logic — simulated payment processing (copied from original)
    // -----------------------------------------------------------------------
    const { amount, currency } = JSON.parse(event.body || "{}");

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

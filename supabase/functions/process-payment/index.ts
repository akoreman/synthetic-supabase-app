Deno.serve(async (req: Request) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!stripeKey || !supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing required environment variables' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { amount, currency } = await req.json();

  // Simulated payment processing
  return new Response(
    JSON.stringify({
      status: 'succeeded',
      amount,
      currency,
      id: `pi_${crypto.randomUUID()}`,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

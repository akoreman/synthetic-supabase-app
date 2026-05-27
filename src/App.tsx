import { useState } from 'react';

export default function App() {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  async function handleGreet() {
    const response = await fetch('/api/hello-world', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      setGreeting(`Error: ${err.message ?? response.statusText}`);
    } else {
      const data = await response.json();
      setGreeting(data?.message ?? 'No message');
    }
  }

  async function handlePayment() {
    const response = await fetch('/api/process-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000, currency: 'usd' }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      setPaymentStatus(`Error: ${err.message ?? response.statusText}`);
    } else {
      const data = await response.json();
      setPaymentStatus(data?.status ?? 'unknown');
    }
  }

  return (
    <div>
      <h1>Synthetic Supabase App</h1>

      <section>
        <h2>Greeting</h2>
        <button onClick={handleGreet}>Say Hello</button>
        {greeting && <p>{greeting}</p>}
      </section>

      <section>
        <h2>Payment</h2>
        <button onClick={handlePayment}>Process Payment</button>
        {paymentStatus && <p>Status: {paymentStatus}</p>}
      </section>
    </div>
  );
}

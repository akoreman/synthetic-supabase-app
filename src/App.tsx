import { useState } from 'react';

export default function App() {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  async function handleGreet() {
    const response = await fetch('/api/hello-world', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    if (!response.ok) {
      setGreeting(`Error: ${data?.message ?? response.statusText}`);
    } else {
      setGreeting(data?.message ?? 'No message');
    }
  }

  async function handlePayment() {
    const response = await fetch('/api/process-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000, currency: 'usd' }),
    });
    const data = await response.json();
    if (!response.ok) {
      setPaymentStatus(`Error: ${data?.message ?? response.statusText}`);
    } else {
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

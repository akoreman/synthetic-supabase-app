import { useState } from 'react';
import { supabase } from './lib/supabase';

export default function App() {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  async function handleGreet() {
    const { data, error } = await supabase.functions.invoke('hello-world');
    if (error) {
      setGreeting(`Error: ${error.message}`);
    } else {
      setGreeting(data?.message ?? 'No message');
    }
  }

  async function handlePayment() {
    const { data, error } = await supabase.functions.invoke('process-payment', {
      body: { amount: 1000, currency: 'usd' },
    });
    if (error) {
      setPaymentStatus(`Error: ${error.message}`);
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

"use client";

import { useState } from "react";
import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { Spinner } from "./components/Spinner";

export default function Home() {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const router = useRouter()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const response = await fetch('/api/login', {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    setLoading(false);
    if (response.ok) {
      sessionStorage.setItem('userId', username);
      router.push('/home')
    } else {
      setError("Incorrect username or password.");
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-paper px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <h2 className="mb-1 text-2xl font-semibold text-ink">Welcome back</h2>
        <p className="mb-7 text-sm text-ink-soft">Log in to continue chatting with your documents.</p>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Username</label>
          <input
            type="text"
            className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="mb-6">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Password</label>
          <input
            type="password"
            className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-surface transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading}
        >
          {loading && <Spinner className="h-4 w-4" />}
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="mt-5 text-center text-sm text-ink-soft">
          Don&apos;t have an account?{" "}
          <Link className="font-medium text-accent hover:text-accent-strong" href="/signup">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}

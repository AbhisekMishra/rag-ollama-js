"use client";

import { useState } from "react";
import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { Spinner } from "../components/Spinner";

export default function Home() {
    const [firstname, setFirstname] = useState<string>("");
    const [lastname, setLastname] = useState<string>("");
    const [username, setUsername] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const [confirmPassword, setConfirmPassword] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const router = useRouter()

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        const response = await fetch('/api/signup', {
            method: "POST",
            body: JSON.stringify({ firstname, lastname, username, password }),
            headers: {
                "Content-Type": "application/json"
            }
        });
        setLoading(false);
        if (response.ok) {
            router.push('/')
        } else {
            setError("Could not create that account. Try a different username.");
        }
    };

    return (
        <div className="flex h-full items-center justify-center overflow-y-auto bg-paper px-4 py-8">
            <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-card sm:p-8">
                <h2 className="mb-1 text-2xl font-semibold text-ink">Create your account</h2>
                <p className="mb-7 text-sm text-ink-soft">Takes a few seconds — then upload a PDF and start asking.</p>

                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">First name</label>
                        <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                            value={firstname}
                            onChange={(e) => setFirstname(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Last name</label>
                        <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                            value={lastname}
                            onChange={(e) => setLastname(e.target.value)}
                            required
                        />
                    </div>
                </div>
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
                <div className="mb-4">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Password</label>
                    <input
                        type="password"
                        className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                    />
                </div>
                <div className="mb-6">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Confirm password</label>
                    <input
                        type="password"
                        className="w-full rounded-lg border border-border bg-paper px-3.5 py-2.5 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
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
                    {loading ? "Creating account…" : "Sign up"}
                </button>

                <p className="mt-5 text-center text-sm text-ink-soft">
                    Have an account?{" "}
                    <Link className="font-medium text-accent hover:text-accent-strong" href="/">
                        Log in
                    </Link>
                </p>
            </form>
        </div>
    );
}

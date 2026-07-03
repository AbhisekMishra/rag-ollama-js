"use client";

import { useState } from "react";
import Link from 'next/link';
import { useRouter } from 'next/navigation'

export default function Home() {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const router = useRouter()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const response = await fetch('/api/login', {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    await response.json();
    setLoading(false);
    if (response.ok) {
      sessionStorage.setItem('userId', username);
      router.push('/home')
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-100 overflow-hidden"  style={{ height: "92vh" }}>
      {loading && <div className="loader"><i className="fas fa-spinner fa-spin"></i></div>}
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-lg max-w-sm w-full">
        <h2 className="text-3xl mb-6 text-blue-600 text-center">Login</h2>
        <div className="mb-6">
          <label className="block mb-2 text-lg font-semibold text-gray-700">Username</label>
          <input
            type="text"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="mb-6">
          <label className="block mb-2 text-lg font-semibold text-gray-700">Password</label>
          <input
            type="password"
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="w-full p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200" type="submit">
          Login
        </button>
        <p className="mt-4 text-center text-gray-600">
          Don&apos;t have an account?
          <Link 
            type="button" 
            className="text-blue-600 underline hover:text-blue-800 transition duration-200"
            href="/signup"
          >
            Sign Up
          </Link>
        </p>
      </form>
    </div>
  );
}


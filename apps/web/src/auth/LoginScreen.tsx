import React, { useState } from "react";
import { useAuth } from "./useAuth";

export function LoginScreen() {
  const login = useAuth((s) => s.login);
  const [businessId, setBusinessId] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(businessId.trim(), secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-box">
        <h1>CRM Dashboard</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="businessId">ID бизнеса</label>
            <input
              id="businessId"
              type="text"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="your-business-id"
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="secret">Секрет</label>
            <input
              id="secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </button>
          {error && <p className="error-msg">{error}</p>}
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Aviso, Campo } from '../components/ui.jsx';

export default function Login() {
  const { entrar } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try { await entrar(u.trim(), p); } catch (err) { setError(err.message); }
    setEnviando(false);
  };

  return (
    <div className="login">
      <form className="tarjeta" onSubmit={enviar}>
        <h1>🐇 La Madriguera</h1>
        <p style={{ color: 'var(--tinta-suave)' }}>Entra con el usuario que te dio un administrador.</p>
        <div className="form">
          <Campo etiqueta="Usuario"><input autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></Campo>
          <Campo etiqueta="Contraseña"><input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></Campo>
          <Aviso tipo="mal">{error}</Aviso>
          <button className="boton" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </div>
      </form>
    </div>
  );
}

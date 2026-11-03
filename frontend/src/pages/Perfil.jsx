import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';

export default function Perfil() {
  const { usuario, esAdmin } = useAuth();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [mensaje, avisar] = useMensaje();

  const cambiar = async (e) => {
    e.preventDefault();
    try {
      await api('yo/password/', { metodo: 'POST', datos: { actual, nueva } });
      setActual(''); setNueva('');
      avisar('bien', 'Contraseña cambiada.');
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <div className="pila">
      <Encabezado titulo="Tu perfil" />
      <section className="tarjeta">
        <h2>{`${usuario.first_name} ${usuario.last_name}`.trim() || usuario.username}</h2>
        <p style={{ marginTop: 6 }}>Usuario: <strong>{usuario.username}</strong></p>
        <p>Rol: <strong>{esAdmin ? 'Administrador' : 'Colaborador'}</strong></p>
        <p style={{ marginTop: 8, color: 'var(--texto-suave)' }}>
          {esAdmin
            ? 'Puedes cambiar la configuración, los bolsillos, costos y precios, gestionar usuarios y borrar registros.'
            : 'Puedes registrar cierres, egresos y ventas, y consultar todos los reportes. Para cambiar configuración o precios, pide ayuda a un administrador.'}
        </p>
      </section>
      <form className="tarjeta" onSubmit={cambiar}>
        <h2>Cambiar contraseña</h2>
        <div className="form" style={{ marginTop: 10 }}>
          <Campo etiqueta="Contraseña actual" className="medio"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required /></Campo>
          <Campo etiqueta="Nueva contraseña" className="medio"><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" minLength={8} required /></Campo>
          <button className="boton">Cambiar contraseña</button>
        </div>
        <div style={{ marginTop: 10 }}>{mensaje}</div>
      </form>
    </div>
  );
}

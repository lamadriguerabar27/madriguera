import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta } from '../format.js';
import { useApi } from '../hooks.js';

const NUEVO = { username: '', first_name: '', last_name: '', email: '', rol: 'colaborador', password: '', is_active: true };

export default function Usuarios() {
  const { usuario } = useAuth();
  const lista = useApi('usuarios/');
  const [f, setF] = useState(null);
  const [mensaje, avisar] = useMensaje();

  const guardar = async () => {
    const datos = { ...f };
    if (!datos.password) delete datos.password;
    try {
      await api(f.id ? `usuarios/${f.id}/` : 'usuarios/', { metodo: f.id ? 'PATCH' : 'POST', datos });
      avisar('bien', f.id ? 'Usuario actualizado.' : `Usuario ${f.username} creado. Compártele su usuario y contraseña.`);
      setF(null);
      lista.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <div className="pila">
      <Encabezado titulo="Usuarios" acciones={<button type="button" className="boton" onClick={() => setF({ ...NUEVO })}>Nuevo usuario</button>}>
        Los administradores cambian la configuración, costos y precios, y pueden borrar registros. Los colaboradores registran cierres, egresos y ventas, y consultan todo.
      </Encabezado>
      {mensaje}
      {f && (
        <section className="tarjeta">
          <div className="tarjeta-cabeza"><h2>{f.id ? f.username : 'Nuevo usuario'}</h2><button type="button" className="enlace" onClick={() => setF(null)}>Cerrar</button></div>
          <div className="form">
            <Campo etiqueta="Usuario" className="medio"><input value={f.username} disabled={!!f.id} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Campo>
            <Campo etiqueta="Nombre" className="medio"><input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Campo>
            <Campo etiqueta="Apellido" className="medio"><input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Campo>
            <Campo etiqueta="Correo" className="medio"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
            <Campo etiqueta="Rol" className="medio">
              <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} disabled={f.id === usuario.id}>
                <option value="colaborador">Colaborador</option><option value="admin">Administrador</option>
              </select>
            </Campo>
            <Campo etiqueta={f.id ? 'Nueva contraseña (opcional)' : 'Contraseña'} className="medio"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Campo>
            {f.id && f.id !== usuario.id && <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Puede entrar</label>}
          </div>
          <button type="button" className="boton" style={{ marginTop: 12 }} onClick={guardar}>Guardar usuario</button>
        </section>
      )}
      <section className="tarjeta">
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último ingreso</th></tr></thead>
            <tbody>
              {(lista.datos || []).map((u) => (
                <tr key={u.id} className="clic" onClick={() => setF({ ...u, password: '' })}>
                  <td>{u.username}</td><td>{`${u.first_name} ${u.last_name}`.trim() || '—'}</td>
                  <td>{u.es_admin ? 'Administrador' : 'Colaborador'}</td>
                  <td>{u.is_active ? 'Activo' : <span className="etiqueta alerta">Sin acceso</span>}</td>
                  <td>{u.last_login ? fechaCorta(u.last_login) : 'Nunca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

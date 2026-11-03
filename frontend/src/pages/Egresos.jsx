import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Cifra, Encabezado, SelectorMes, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, mesActual, n, nombreMes, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const VACIO = { fecha: hoy(), origen: 'cuenta', bolsillo: '', categoria: 'proveedores', descripcion: '', valor: '' };

export default function Egresos() {
  const { esAdmin } = useAuth();
  const [f, setF] = useState(VACIO);
  const [mes, setMes] = useState(mesActual());
  const [mensaje, avisar] = useMensaje();
  const [borrando, setBorrando] = useState(null);
  const ops = useApi('opciones/finanzas/');
  const bols = useApi('bolsillos/');
  const { desde, hasta } = rangoMes(mes);
  const lista = useApi(`egresos/?desde=${desde}&hasta=${hasta}`);
  const cambia = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const guardar = async (e) => {
    e.preventDefault();
    try {
      await api('egresos/', { metodo: 'POST', datos: { ...f, valor: n(f.valor), bolsillo: f.origen === 'bolsillo' ? Number(f.bolsillo) || null : null } });
      avisar('bien', 'Egreso registrado.');
      setF({ ...VACIO, fecha: f.fecha, origen: f.origen, categoria: f.categoria });
      lista.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const borrar = async (id) => {
    if (borrando !== id) { setBorrando(id); return; }
    try { await api(`egresos/${id}/`, { metodo: 'DELETE' }); lista.recargar(); avisar('bien', 'Egreso borrado.'); } catch (err) { avisar('mal', err.message); }
    setBorrando(null);
  };

  const datos = lista.datos || [];
  const suma = (fn) => datos.filter(fn).reduce((s, e) => s + n(e.valor), 0);

  return (
    <div className="pila">
      <Encabezado titulo="Egresos">Todo lo que sale: de la caja, de la cuenta o de un bolsillo, y para qué.</Encabezado>
      <form className="tarjeta" onSubmit={guardar}>
        <div className="form">
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={f.fecha} onChange={cambia('fecha')} required /></Campo>
          <Campo etiqueta="Salió de" className="medio">
            <select value={f.origen} onChange={cambia('origen')}>
              {(ops.datos?.origenes_egreso || []).map((o) => <option key={o.valor} value={o.valor}>{o.nombre}</option>)}
            </select>
          </Campo>
          {f.origen === 'bolsillo' && (
            <Campo etiqueta="Bolsillo" className="medio">
              <select value={f.bolsillo} onChange={cambia('bolsillo')} required>
                <option value="">Elige uno</option>
                {(bols.datos || []).filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Categoría" className="medio">
            <select value={f.categoria} onChange={cambia('categoria')}>
              {(ops.datos?.categorias_egreso || []).map((o) => <option key={o.valor} value={o.valor}>{o.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Para qué" className="ancho"><input value={f.descripcion} maxLength={200} onChange={cambia('descripcion')} required placeholder="Ej.: hielo, pago de luz, limones" /></Campo>
          <Campo etiqueta="Valor" className="medio"><input type="number" min="0" step="any" inputMode="numeric" value={f.valor} onChange={cambia('valor')} required /></Campo>
          <button className="boton">Registrar egreso</button>
        </div>
        <div style={{ marginTop: 10 }}>{mensaje}</div>
      </form>

      <div className="form"><SelectorMes valor={mes} onChange={setMes} /></div>
      <div className="cifras">
        <Cifra titulo={`Egresos de ${nombreMes(mes)}`} valor={pesos(suma(() => true))} destacada />
        <Cifra titulo="De la caja" valor={pesos(suma((e) => e.origen === 'caja'))} />
        <Cifra titulo="De la cuenta" valor={pesos(suma((e) => e.origen === 'cuenta'))} />
        <Cifra titulo="De bolsillos" valor={pesos(suma((e) => e.origen === 'bolsillo'))} />
      </div>

      <section className="tarjeta">
        <h2>Detalle</h2>
        {datos.length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Para qué</th><th>Categoría</th><th>Salió de</th><th>Registró</th><th className="n">Valor</th>{esAdmin && <th />}</tr></thead>
              <tbody>
                {datos.map((e) => (
                  <tr key={e.id}>
                    <td>{fechaCorta(e.fecha)}</td><td>{e.descripcion}</td><td>{e.categoria_nombre}</td><td>{e.origen_nombre}</td>
                    <td>{e.creado_por_nombre || '—'}</td><td className="n">{pesos(e.valor)}</td>
                    {esAdmin && <td><button type="button" className="boton peligro chico" onClick={() => borrar(e.id)}>{borrando === e.id ? 'Confirmar' : 'Borrar'}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">No hay egresos registrados en {nombreMes(mes)}.</p>}
      </section>
    </div>
  );
}

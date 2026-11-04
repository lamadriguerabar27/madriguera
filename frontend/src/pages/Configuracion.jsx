import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { n, pct } from '../format.js';
import { useApi } from '../hooks.js';

const CAMPOS = [
  ['meta_mensual', 'Meta de ventas mensual', 100000],
  ['dias_abiertos', 'Días abiertos al mes', 1],
  ['arriendo_mensual', 'Arriendo y servicios al mes', 10000],
  ['porcentaje_caja', '% del efectivo que queda en caja', 0.5],
  ['tasa_ea', 'Tasa de los bolsillos (% E.A.)', 0.1],
  ['margen_objetivo', 'Margen bruto objetivo (%)', 1],
  ['ml_por_onza', 'Mililitros por onza', 0.001],
  ['redondeo_precio', 'Redondear precios a múltiplos de', 50],
];

export default function Configuracion() {
  const cfg = useApi('configuracion/');
  const socios = useApi('socios/');
  const bols = useApi('bolsillos/');
  const [c, setC] = useState(null);
  const [filas, setFilas] = useState([]);
  const [mensaje, avisar] = useMensaje();

  useEffect(() => { if (cfg.datos) setC(Object.fromEntries(Object.entries(cfg.datos).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v)]))); }, [cfg.datos]);
  useEffect(() => { if (bols.datos) setFilas(bols.datos.map((b) => ({ ...b, porcentaje: String(n(b.porcentaje)) }))); }, [bols.datos]);

  const total = filas.filter((b) => b.activo).reduce((s, b) => s + n(b.porcentaje), 0);

  const guardarCfg = async () => {
    const datos = Object.fromEntries(CAMPOS.map(([k]) => [k, n(c[k])]));
    datos.iva_es_costo = c.iva_es_costo;
    try { await api('configuracion/', { metodo: 'PATCH', datos }); avisar('bien', 'Configuración guardada.'); cfg.recargar(); } catch (err) { avisar('mal', err.message); }
  };

  const guardarBolsillos = async () => {
    if (total > 100) { avisar('mal', 'Los bolsillos activos suman más de 100%. Ajusta los porcentajes.'); return; }
    try {
      for (const [i, b] of filas.entries()) {
        const datos = { nombre: b.nombre.trim(), porcentaje: n(b.porcentaje), se_vacia_cada_mes: b.se_vacia_cada_mes, activo: b.activo, orden: i };
        if (!datos.nombre) continue;
        await api(b.id ? `bolsillos/${b.id}/` : 'bolsillos/', { metodo: b.id ? 'PUT' : 'POST', datos });
      }
      avisar('bien', 'Bolsillos guardados. Aplican a los cierres que se guarden desde ahora.');
      bols.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const quitar = async (b, i) => {
    if (!b.id) { setFilas(filas.filter((_, j) => j !== i)); return; }
    try { const r = await api(`bolsillos/${b.id}/`, { metodo: 'DELETE' }); avisar('bien', r?.detail || 'Bolsillo borrado.'); bols.recargar(); } catch (err) { avisar('mal', err.message); }
  };

  const set = (i, k, v) => setFilas(filas.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  return (
    <div className="pila">
      <Encabezado titulo="Configuración">Parámetros del negocio. Los cambios aplican desde que se guardan; los cierres anteriores conservan sus porcentajes.</Encabezado>
      {mensaje}
      {c && (
        <section className="tarjeta">
          <h2>General</h2>
          <div className="form" style={{ marginTop: 12 }}>
            {CAMPOS.map(([k, etiqueta, paso]) => (
              <Campo key={k} etiqueta={etiqueta} className="medio"><input type="number" min="0" step="any" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></Campo>
            ))}
            <label className="check"><input type="checkbox" checked={!!c.iva_es_costo} onChange={(e) => setC({ ...c, iva_es_costo: e.target.checked })} /> El IVA de las facturas es costo (no lo descontamos)</label>
          </div>
          <button type="button" className="boton" style={{ marginTop: 14 }} onClick={guardarCfg}>Guardar configuración</button>
        </section>
      )}
      <Socios lista={socios.datos || []} recargar={socios.recargar} avisar={avisar} />
      <section className="tarjeta">
        <h2>Bolsillos</h2>
        <p>Porcentaje de cada ingreso a la cuenta que la app del banco aparta en cada bolsillo. Mantén estos valores iguales a los de la app.</p>
        <div className="tabla-caja" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Nombre</th><th className="n">%</th><th>Se vacía cada mes</th><th>Activo</th><th /></tr></thead>
            <tbody>
              {filas.map((b, i) => (
                <tr key={b.id || `n${i}`}>
                  <td><input className="entrada" value={b.nombre} onChange={(e) => set(i, 'nombre', e.target.value)} /></td>
                  <td style={{ width: 110 }}><input className="entrada" type="number" min="0" max="100" step="any" value={b.porcentaje} onChange={(e) => set(i, 'porcentaje', e.target.value)} /></td>
                  <td><input type="checkbox" checked={b.se_vacia_cada_mes} onChange={(e) => set(i, 'se_vacia_cada_mes', e.target.checked)} aria-label="Se vacía cada mes" /></td>
                  <td><input type="checkbox" checked={b.activo} onChange={(e) => set(i, 'activo', e.target.checked)} aria-label="Activo" /></td>
                  <td><button type="button" className="boton peligro chico" onClick={() => quitar(b, i)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 10 }} className={total > 100 ? 'neg' : ''}>Total a bolsillos: <strong>{pct(total)}</strong> · Queda disponible en la cuenta: <strong>{pct(100 - total)}</strong></p>
        <div className="form" style={{ marginTop: 10 }}>
          <button type="button" className="boton secundario" onClick={() => setFilas([...filas, { nombre: '', porcentaje: '0', se_vacia_cada_mes: false, activo: true }])}>Agregar bolsillo</button>
          <button type="button" className="boton" onClick={guardarBolsillos}>Guardar bolsillos</button>
        </div>
      </section>
    </div>
  );
}

function Socios({ lista, recargar, avisar }) {
  const [filas, setFilas] = useState(null);
  const datos = filas ?? lista.map((s) => ({ ...s, porcentaje: String(n(s.porcentaje)) }));
  const set = (i, k, v) => setFilas(datos.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const total = datos.filter((s) => s.activo).reduce((t, s) => t + n(s.porcentaje), 0);
  const guardar = async () => {
    if (total > 100) { avisar('mal', 'Los socios activos suman más de 100%.'); return; }
    try {
      // Primero los que bajan o se desactivan, para no pasar de 100% a mitad de camino
      const orden = [...datos].sort((a, b) => n(a.porcentaje) - n(b.porcentaje));
      for (const s of orden) {
        if (!s.nombre.trim()) continue;
        const d = { nombre: s.nombre.trim(), porcentaje: n(s.porcentaje), activo: s.activo };
        await api(s.id ? `socios/${s.id}/` : 'socios/', { metodo: s.id ? 'PUT' : 'POST', datos: d });
      }
      setFilas(null); recargar(); avisar('bien', 'Socios guardados.');
    } catch (err) { avisar('mal', err.message); }
  };
  const quitar = async (s, i) => {
    if (!s.id) { setFilas(datos.filter((_, j) => j !== i)); return; }
    try { await api(`socios/${s.id}/`, { metodo: 'DELETE' }); setFilas(null); recargar(); } catch (err) { avisar('mal', err.message); }
  };
  return (
    <section className="tarjeta">
      <h2>Socios</h2>
      <p>Porcentaje de la ganancia neta libre que le corresponde a cada socio en la liquidación.</p>
      <div className="tabla-caja" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Nombre</th><th className="n">%</th><th>Activo</th><th /></tr></thead>
          <tbody>
            {datos.map((s, i) => (
              <tr key={s.id || `n${i}`}>
                <td><input className="entrada" value={s.nombre} onChange={(e) => set(i, 'nombre', e.target.value)} /></td>
                <td style={{ width: 110 }}><input className="entrada" type="number" min="0" max="100" step="any" value={s.porcentaje} onChange={(e) => set(i, 'porcentaje', e.target.value)} /></td>
                <td><input type="checkbox" checked={s.activo} onChange={(e) => set(i, 'activo', e.target.checked)} aria-label="Activo" /></td>
                <td><button type="button" className="boton peligro chico" onClick={() => quitar(s, i)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10 }} className={total > 100 ? 'neg' : ''}>Total asignado: <strong>{pct(total)}</strong>{total < 100 && ` · ${pct(100 - total)} queda en el negocio`}</p>
      <div className="form" style={{ marginTop: 10 }}>
        <button type="button" className="boton secundario" onClick={() => setFilas([...datos, { nombre: '', porcentaje: '0', activo: true }])}>Agregar socio</button>
        <button type="button" className="boton" onClick={guardar}>Guardar socios</button>
      </div>
    </section>
  );
}

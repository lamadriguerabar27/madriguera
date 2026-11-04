import { useState } from 'react';
import { api } from '../api.js';
import { Barras } from '../components/charts.jsx';
import { Campo, Cifra, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, mesActual, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const CAMPOS = [['fecha', 'Fecha'], ['valor', 'Valor de la venta'], ['estado', 'Estado'], ['referencia', 'ID o referencia'], ['metodo', 'Método de pago']];

export default function Bold() {
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState(null);
  const [mapa, setMapa] = useState({});
  const [estados, setEstados] = useState(null);
  const [actualizar, setActualizar] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [mes, setMes] = useState(mesActual());
  const [borrando, setBorrando] = useState(null);
  const [mensaje, avisar] = useMensaje();
  const { desde, hasta } = rangoMes(mes);
  const hist = useApi(`bold/ventas/?desde=${desde}&hasta=${hasta}`);

  const enviar = async (aplicar, nuevoMapa = mapa, nuevosEstados = estados) => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('mapa', JSON.stringify(nuevoMapa));
    if (nuevosEstados) fd.append('estados', JSON.stringify(nuevosEstados));
    if (aplicar) { fd.append('aplicar', '1'); fd.append('actualizar_cierres', actualizar ? '1' : '0'); }
    setCargando(true);
    try {
      const r = await api('bold/importar/', { metodo: 'POST', archivo: fd });
      if (aplicar) {
        avisar('bien', `Se guardaron ${r.guardadas} ventas de ${r.dias} día(s)${r.repetidas ? ` (${r.repetidas} ya estaban cargadas y se omitieron)` : ''}. Cierres actualizados: ${r.cierres_actualizados}, nuevos: ${r.cierres_creados}.`);
        setVista(null); setArchivo(null); setMapa({}); setEstados(null);
        hist.recargar();
      } else {
        setVista(r);
        setMapa(r.mapa);
        if (!nuevosEstados) setEstados(null);
      }
    } catch (err) {
      if (err.status === 422 && err.data?.encabezados) { setVista({ encabezados: err.data.encabezados, muestra: err.data.muestra, resumen: null }); setMapa(err.data.mapa || {}); }
      avisar('mal', err.message);
    }
    setCargando(false);
  };

  const cambiarMapa = (k, v) => { const m = { ...mapa, [k]: v }; setMapa(m); enviar(false, m, estados); };
  const estadosMarcados = estados ?? vista?.resumen?.estados.filter((e) => /aprob|exitos|pagad|approved|success|complet|abonad|sin estado/i.test(e.estado)).map((e) => e.estado);
  const alternarEstado = (e) => {
    const base = new Set(estadosMarcados || []);
    if (base.has(e)) base.delete(e); else base.add(e);
    const lista = [...base].map((x) => (x === '(sin estado)' ? '' : x));
    setEstados([...base]);
    enviar(false, mapa, lista);
  };

  const borrarImportacion = async (lote) => {
    if (borrando !== lote) { setBorrando(lote); return; }
    try { await api(`bold/importaciones/${lote}/`, { metodo: 'DELETE' }); avisar('bien', 'Importación borrada; los cierres se recalcularon.'); hist.recargar(); } catch (err) { avisar('mal', err.message); }
    setBorrando(null);
  };

  return (
    <div className="pila">
      <Encabezado titulo="Historial de Bold">
        Sube el reporte de ventas que descargas del panel de Bold (CSV o Excel). Las ventas de cada día quedan como ventas Bold del cierre de ese día; el efectivo que ya registraste se conserva.
      </Encabezado>
      {mensaje}
      <section className="tarjeta">
        <h2>Importar reporte</h2>
        <div className="form" style={{ marginTop: 10 }}>
          <input type="file" accept=".csv,.xlsx,.xlsm,text/csv" onChange={(e) => { setArchivo(e.target.files?.[0] || null); setVista(null); setMapa({}); setEstados(null); }} />
          <button type="button" className="boton secundario" disabled={!archivo || cargando} onClick={() => enviar(false)}>{cargando ? 'Leyendo…' : 'Revisar archivo'}</button>
        </div>
        {vista && (
          <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>Columnas</h3>
              <div className="form">
                {CAMPOS.map(([k, nombre]) => (
                  <Campo key={k} etiqueta={nombre} className="medio">
                    <select value={mapa[k] || ''} onChange={(e) => cambiarMapa(k, e.target.value)}>
                      <option value="">{k === 'fecha' || k === 'valor' ? 'Elige una columna' : 'No usar'}</option>
                      {vista.encabezados.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </Campo>
                ))}
              </div>
            </div>
            {vista.resumen && (
              <>
                {vista.resumen.estados.length > 1 && (
                  <div>
                    <h3 style={{ marginBottom: 6 }}>Qué estados cuentan como venta</h3>
                    <div className="form">
                      {vista.resumen.estados.map((e) => (
                        <label key={e.estado} className="check"><input type="checkbox" checked={(estadosMarcados || []).includes(e.estado)} onChange={() => alternarEstado(e.estado)} /> {e.estado} ({e.filas})</label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="cifras">
                  <Cifra titulo="Ventas válidas" valor={vista.resumen.validas} destacada />
                  <Cifra titulo="Total" valor={pesos(vista.resumen.total)} />
                  <Cifra titulo="Días" valor={vista.resumen.dias.length} />
                  <Cifra titulo="Descartadas" valor={vista.resumen.descartadas_por_estado + vista.resumen.sin_fecha_o_valor} nota="Por estado o sin fecha/valor" />
                </div>
                <div className="tabla-caja">
                  <table>
                    <thead><tr><th>Día</th><th className="n">Ventas</th><th className="n">Total Bold</th></tr></thead>
                    <tbody>{vista.resumen.dias.map((d) => <tr key={d.fecha}><td>{fechaCorta(d.fecha)}</td><td className="n">{d.transacciones}</td><td className="n">{pesos(d.total)}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="form">
                  <label className="check"><input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} /> Poner estos totales como ventas Bold en el cierre de cada día</label>
                  <button type="button" className="boton" disabled={cargando || !vista.resumen.validas} onClick={() => enviar(true)}>Guardar {vista.resumen.validas} ventas</button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="tarjeta">
        <div className="tarjeta-cabeza">
          <h2>Ventas Bold cargadas</h2>
          <Campo etiqueta="Mes" className="medio"><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Campo>
        </div>
        {hist.datos?.dias.length ? (
          <>
            <p style={{ marginBottom: 8 }}>Total del mes: <strong className="num">{pesos(hist.datos.total)}</strong></p>
            <Barras datos={hist.datos.dias.map((d) => ({ ...d, dia: d.fecha.slice(8) }))} x="dia" series={[{ clave: 'total', nombre: 'Ventas Bold', color: 'var(--serie-1)' }]} />
          </>
        ) : <p className="vacio">No hay ventas de Bold cargadas en este mes.</p>}
        {hist.datos?.importaciones.length > 0 && (
          <>
            <h3 style={{ margin: '14px 0 6px' }}>Importaciones</h3>
            <div className="tabla-caja">
              <table>
                <thead><tr><th>Fechas</th><th className="n">Ventas</th><th className="n">Total</th><th /></tr></thead>
                <tbody>
                  {hist.datos.importaciones.map((i) => (
                    <tr key={i.importacion}>
                      <td>{fechaCorta(i.desde)} a {fechaCorta(i.hasta)}</td><td className="n">{i.transacciones}</td><td className="n">{pesos(i.total)}</td>
                      <td style={{ textAlign: 'right' }}><button type="button" className="boton peligro chico" onClick={() => borrarImportacion(i.importacion)}>{borrando === i.importacion ? 'Confirmar' : 'Borrar'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

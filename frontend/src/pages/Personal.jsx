import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, mesActual, n, numero, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const TRAB = { nombre: '', documento: '', cargo: '', telefono: '', tipo_pago: 'hora', valor_pago: '', fecha_ingreso: '', activo: true };
const TURNO = { fecha: hoy(), trabajador: '', hora_inicio: '', hora_fin: '', horas: '', efectivo_inicio: '', efectivo_fin: '', notas: '' };
const VALOR = { hora: 'Valor por hora', semanal: 'Pago por semana', quincenal: 'Pago por quincena', mensual: 'Pago por mes' };

export default function Personal() {
  const { esAdmin } = useAuth();
  const trabajadores = useApi('trabajadores/');
  const [mes, setMes] = useState(mesActual());
  const { desde, hasta } = rangoMes(mes);
  const turnos = useApi(`turnos/?desde=${desde}&hasta=${hasta}`);
  const [t, setT] = useState(null);
  const [tu, setTu] = useState(TURNO);
  const [borrando, setBorrando] = useState(null);
  const [mensaje, avisar] = useMensaje();
  const activos = (trabajadores.datos || []).filter((x) => x.activo);

  const guardarTrabajador = async () => {
    const datos = { ...t, valor_pago: n(t.valor_pago), fecha_ingreso: t.fecha_ingreso || null };
    try {
      await api(t.id ? `trabajadores/${t.id}/` : 'trabajadores/', { metodo: t.id ? 'PUT' : 'POST', datos });
      avisar('bien', `${t.nombre} guardado.`); setT(null); trabajadores.recargar();
    } catch (err) { avisar('mal', err.message); }
  };
  const borrarTrabajador = async () => {
    try { const r = await api(`trabajadores/${t.id}/`, { metodo: 'DELETE' }); avisar('bien', r?.detail || 'Trabajador borrado.'); setT(null); trabajadores.recargar(); } catch (err) { avisar('mal', err.message); }
  };

  const guardarTurno = async (e) => {
    e.preventDefault();
    const num = (v) => (v === '' ? null : n(v));
    const datos = { ...tu, trabajador: Number(tu.trabajador), hora_inicio: tu.hora_inicio || null, hora_fin: tu.hora_fin || null,
      horas: n(tu.horas), efectivo_inicio: num(tu.efectivo_inicio), efectivo_fin: num(tu.efectivo_fin) };
    try {
      await api(tu.id ? `turnos/${tu.id}/` : 'turnos/', { metodo: tu.id ? 'PUT' : 'POST', datos });
      avisar('bien', tu.id ? 'Turno actualizado.' : 'Turno registrado.');
      setTu({ ...TURNO, fecha: tu.fecha, trabajador: tu.id ? '' : tu.trabajador });
      turnos.recargar();
    } catch (err) { avisar('mal', err.message); }
  };
  const borrarTurno = async (id) => {
    if (borrando !== id) { setBorrando(id); return; }
    try { await api(`turnos/${id}/`, { metodo: 'DELETE' }); turnos.recargar(); avisar('bien', 'Turno borrado.'); } catch (err) { avisar('mal', err.message); }
    setBorrando(null);
  };

  const horasPor = useMemo(() => {
    const m = {};
    for (const x of turnos.datos || []) m[x.trabajador_nombre] = (m[x.trabajador_nombre] || 0) + n(x.horas);
    return Object.entries(m);
  }, [turnos.datos]);
  const val = (v) => (v == null ? '' : String(v));

  return (
    <div className="pila">
      <Encabezado titulo="Personal y turnos" acciones={esAdmin && <button type="button" className="boton" onClick={() => setT({ ...TRAB })}>Nuevo trabajador</button>}>
        Quién trabaja, cuánto se le paga y los turnos de cada día. Las horas alimentan la nómina de la liquidación, y el efectivo al iniciar y cerrar el turno sirve para cuadrar la caja.
      </Encabezado>
      {mensaje}
      {t && (
        <section className="tarjeta">
          <div className="tarjeta-cabeza"><h2>{t.id ? t.nombre : 'Nuevo trabajador'}</h2><button type="button" className="enlace" onClick={() => setT(null)}>Cerrar</button></div>
          <div className="form">
            <Campo etiqueta="Nombre completo" className="ancho"><input value={t.nombre} onChange={(e) => setT({ ...t, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Documento o RUT" className="medio"><input value={t.documento} onChange={(e) => setT({ ...t, documento: e.target.value })} /></Campo>
            <Campo etiqueta="Cargo" className="medio"><input value={t.cargo} onChange={(e) => setT({ ...t, cargo: e.target.value })} placeholder="Ej.: bartender, mesero" /></Campo>
            <Campo etiqueta="Teléfono" className="medio"><input value={t.telefono} onChange={(e) => setT({ ...t, telefono: e.target.value })} /></Campo>
            <Campo etiqueta="Se le paga" className="medio">
              <select value={t.tipo_pago} onChange={(e) => setT({ ...t, tipo_pago: e.target.value })}>
                <option value="hora">Por hora</option><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option>
              </select>
            </Campo>
            <Campo etiqueta={VALOR[t.tipo_pago]} className="medio"><input type="number" min="0" step="any" value={t.valor_pago} onChange={(e) => setT({ ...t, valor_pago: e.target.value })} /></Campo>
            <Campo etiqueta="Fecha de ingreso" className="medio"><input type="date" value={t.fecha_ingreso || ''} onChange={(e) => setT({ ...t, fecha_ingreso: e.target.value })} /></Campo>
            {t.id && <label className="check"><input type="checkbox" checked={t.activo} onChange={(e) => setT({ ...t, activo: e.target.checked })} /> Activo</label>}
          </div>
          <div className="form" style={{ marginTop: 12 }}>
            <button type="button" className="boton" onClick={guardarTrabajador} disabled={!t.nombre || t.valor_pago === ''}>Guardar</button>
            {t.id && <button type="button" className="boton peligro" onClick={borrarTrabajador}>Borrar</button>}
          </div>
        </section>
      )}

      <section className="tarjeta">
        <h2>Trabajadores</h2>
        {(trabajadores.datos || []).length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Nombre</th><th>Documento</th><th>Cargo</th><th>Pago</th><th className="n">Valor</th><th>Estado</th></tr></thead>
              <tbody>
                {trabajadores.datos.map((x) => (
                  <tr key={x.id} className={esAdmin ? 'clic' : ''} onClick={() => esAdmin && setT({ ...x, valor_pago: String(n(x.valor_pago)), fecha_ingreso: x.fecha_ingreso || '' })}>
                    <td>{x.nombre}</td><td>{x.documento || '—'}</td><td>{x.cargo || '—'}</td><td>{x.tipo_pago_nombre}</td>
                    <td className="n">{pesos(x.valor_pago)}</td><td>{x.activo ? 'Activo' : <span className="etiqueta alerta">Inactivo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">Aún no hay trabajadores registrados.</p>}
      </section>

      <form className="tarjeta" onSubmit={guardarTurno}>
        <div className="tarjeta-cabeza"><h2>{tu.id ? 'Editar turno' : 'Registrar turno'}</h2>{tu.id && <button type="button" className="enlace" onClick={() => setTu(TURNO)}>Cancelar edición</button>}</div>
        <div className="form">
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={tu.fecha} onChange={(e) => setTu({ ...tu, fecha: e.target.value })} required /></Campo>
          <Campo etiqueta="Trabajador" className="medio">
            <select value={tu.trabajador} onChange={(e) => setTu({ ...tu, trabajador: e.target.value })} required>
              <option value="">Elige</option>
              {activos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Entrada" className="corto"><input type="time" value={tu.hora_inicio} onChange={(e) => setTu({ ...tu, hora_inicio: e.target.value })} /></Campo>
          <Campo etiqueta="Salida" className="corto"><input type="time" value={tu.hora_fin} onChange={(e) => setTu({ ...tu, hora_fin: e.target.value })} /></Campo>
          <Campo etiqueta="o número de horas" className="corto"><input type="number" min="0" max="24" step="any" value={tu.horas} disabled={!!(tu.hora_inicio && tu.hora_fin)} onChange={(e) => setTu({ ...tu, horas: e.target.value })} /></Campo>
          <Campo etiqueta="Efectivo al iniciar" className="medio"><input type="number" min="0" step="any" value={tu.efectivo_inicio} onChange={(e) => setTu({ ...tu, efectivo_inicio: e.target.value })} /></Campo>
          <Campo etiqueta="Efectivo al cerrar" className="medio"><input type="number" min="0" step="any" value={tu.efectivo_fin} onChange={(e) => setTu({ ...tu, efectivo_fin: e.target.value })} /></Campo>
          <Campo etiqueta="Notas" className="ancho"><input value={tu.notas} maxLength={200} onChange={(e) => setTu({ ...tu, notas: e.target.value })} /></Campo>
          <button className="boton">{tu.id ? 'Guardar cambios' : 'Registrar turno'}</button>
        </div>
      </form>

      <section className="tarjeta">
        <div className="tarjeta-cabeza">
          <h2>Turnos del mes</h2>
          <Campo etiqueta="Mes" className="medio"><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Campo>
        </div>
        {horasPor.length > 0 && <p style={{ marginBottom: 10 }}>{horasPor.map(([nom, h]) => `${nom}: ${numero(h)} h`).join(' · ')}</p>}
        {(turnos.datos || []).length ? (
          <div className="tabla-caja">
            <table>
              <thead><tr><th>Fecha</th><th>Trabajador</th><th>Horario</th><th className="n">Horas</th><th className="n">Caja inicio</th><th className="n">Caja cierre</th><th className="n">Diferencia</th><th /></tr></thead>
              <tbody>
                {turnos.datos.map((x) => (
                  <tr key={x.id}>
                    <td>{fechaCorta(x.fecha)}</td><td>{x.trabajador_nombre}</td>
                    <td>{x.hora_inicio ? `${x.hora_inicio.slice(0, 5)}–${(x.hora_fin || '').slice(0, 5)}` : '—'}</td>
                    <td className="n">{numero(x.horas)}</td>
                    <td className="n">{x.efectivo_inicio == null ? '—' : pesos(x.efectivo_inicio)}</td>
                    <td className="n">{x.efectivo_fin == null ? '—' : pesos(x.efectivo_fin)}</td>
                    <td className="n">{x.diferencia_caja == null ? '—' : pesos(x.diferencia_caja)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {esAdmin && <>
                        <button type="button" className="boton secundario chico" onClick={() => setTu({ ...x, trabajador: String(x.trabajador), hora_inicio: (x.hora_inicio || '').slice(0, 5), hora_fin: (x.hora_fin || '').slice(0, 5), horas: val(x.horas), efectivo_inicio: val(x.efectivo_inicio), efectivo_fin: val(x.efectivo_fin) })}>Editar</button>{' '}
                        <button type="button" className="boton peligro chico" onClick={() => borrarTurno(x.id)}>{borrando === x.id ? 'Confirmar' : 'Borrar'}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">No hay turnos registrados en este mes.</p>}
      </section>
    </div>
  );
}

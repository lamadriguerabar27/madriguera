import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Cifra, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, n, pct, pesos } from '../format.js';
import { useApi } from '../hooks.js';

const pad = (x) => String(x).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function periodo(clave) {
  const h = new Date(`${hoy()}T12:00:00`);
  const y = h.getFullYear(), m = h.getMonth(), d = h.getDate();
  const lunes = new Date(h); lunes.setDate(d - ((h.getDay() + 6) % 7));
  const finMes = (yy, mm) => new Date(yy, mm + 1, 0);
  switch (clave) {
    case 'semana': { const f = new Date(lunes); f.setDate(f.getDate() + 6); return [iso(lunes), iso(f), 'semana']; }
    case 'semana_ant': { const i = new Date(lunes); i.setDate(i.getDate() - 7); const f = new Date(lunes); f.setDate(f.getDate() - 1); return [iso(i), iso(f), 'semana']; }
    case 'quincena': return d <= 15 ? [iso(new Date(y, m, 1)), iso(new Date(y, m, 15)), 'quincena'] : [iso(new Date(y, m, 16)), iso(finMes(y, m)), 'quincena'];
    case 'quincena_ant': return d <= 15 ? [iso(new Date(y, m - 1, 16)), iso(finMes(y, m - 1)), 'quincena'] : [iso(new Date(y, m, 1)), iso(new Date(y, m, 15)), 'quincena'];
    case 'mes': return [iso(new Date(y, m, 1)), iso(finMes(y, m)), 'mes'];
    case 'mes_ant': return [iso(new Date(y, m - 1, 1)), iso(finMes(y, m - 1)), 'mes'];
    default: return null;
  }
}
const OPCIONES = [['semana', 'Esta semana'], ['semana_ant', 'Semana pasada'], ['quincena', 'Esta quincena'], ['quincena_ant', 'Quincena pasada'], ['mes', 'Este mes'], ['mes_ant', 'Mes pasado'], ['otro', 'Otras fechas']];

export default function Liquidacion() {
  const { esAdmin } = useAuth();
  const [clave, setClave] = useState('quincena');
  const [rango, setRango] = useState(periodo('quincena'));
  const [provision, setProvision] = useState(true);
  const [pagos, setPagos] = useState({ nomina: {}, socios: {} });
  const [pago, setPago] = useState({ fecha: hoy(), origen: 'cuenta', bolsillo: '' });
  const [mensaje, avisar] = useMensaje();
  const [desde, hasta, tipo] = rango;
  const liq = useApi(`liquidacion/?desde=${desde}&hasta=${hasta}&tipo=${tipo}&provision=${provision ? 1 : 0}`);
  const guardadas = useApi('liquidaciones/');
  const bols = useApi('bolsillos/');
  const d = liq.datos;

  useEffect(() => {
    if (!d) return;
    setPagos({
      nomina: Object.fromEntries(d.nomina.filter((x) => x.pendiente > 0).map((x) => [x.id, String(x.pendiente)])),
      socios: Object.fromEntries(d.socios.filter((x) => x.por_pagar > 0).map((x) => [x.id, String(x.por_pagar)])),
    });
  }, [d]);

  const elegir = (c) => { setClave(c); if (c !== 'otro') setRango(periodo(c)); };

  const registrar = async (tipoPago, lista) => {
    const items = lista.filter((x) => n(pagos[tipoPago][x.id]) > 0).map((x) => ({ id: x.id, valor: n(pagos[tipoPago][x.id]) }));
    if (!items.length) { avisar('mal', 'No hay valores para pagar.'); return; }
    try {
      const r = await api('liquidacion/pagos/', { metodo: 'POST', datos: { tipo: tipoPago, ...pago, bolsillo: pago.origen === 'bolsillo' ? Number(pago.bolsillo) : null, items } });
      avisar('bien', `Se registraron ${r.registrados} pago(s) por ${pesos(r.total)} como egresos.`);
      liq.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const guardar = async () => {
    try { await api('liquidaciones/', { metodo: 'POST', datos: { desde, hasta, tipo, provisionar_arriendo: provision } }); avisar('bien', 'Liquidación guardada en el histórico.'); guardadas.recargar(); } catch (err) { avisar('mal', err.message); }
  };
  const borrarGuardada = async (id) => {
    try { await api(`liquidaciones/${id}/`, { metodo: 'DELETE' }); guardadas.recargar(); } catch (err) { avisar('mal', err.message); }
  };

  const origen = (
    <div className="form">
      <Campo etiqueta="Fecha del pago" className="medio"><input type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} /></Campo>
      <Campo etiqueta="Sale de" className="medio">
        <select value={pago.origen} onChange={(e) => setPago({ ...pago, origen: e.target.value })}>
          <option value="cuenta">Cuenta (disponible)</option><option value="caja">Caja</option><option value="bolsillo">Bolsillo</option>
        </select>
      </Campo>
      {pago.origen === 'bolsillo' && (
        <Campo etiqueta="Bolsillo" className="medio">
          <select value={pago.bolsillo} onChange={(e) => setPago({ ...pago, bolsillo: e.target.value })}>
            <option value="">Elige</option>{(bols.datos || []).filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
      )}
    </div>
  );

  return (
    <div className="pila">
      <Encabezado titulo="Liquidación">
        Al cierre de la semana, la quincena o el mes: lo que se vendió, lo que se gastó, la nómina, y cuánto le queda libre a cada socio.
      </Encabezado>
      <section className="tarjeta">
        <div className="form">
          <Campo etiqueta="Periodo" className="medio">
            <select value={clave} onChange={(e) => elegir(e.target.value)}>{OPCIONES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Campo>
          <Campo etiqueta="Desde" className="medio"><input type="date" value={desde} onChange={(e) => { setClave('otro'); setRango([e.target.value, hasta, 'otro']); }} /></Campo>
          <Campo etiqueta="Hasta" className="medio"><input type="date" value={hasta} onChange={(e) => { setClave('otro'); setRango([desde, e.target.value, 'otro']); }} /></Campo>
          <label className="check"><input type="checkbox" checked={provision} onChange={(e) => setProvision(e.target.checked)} /> Apartar el arriendo del periodo aunque no se haya pagado</label>
        </div>
      </section>
      {mensaje}
      {liq.error && <p className="aviso mal">{liq.error}</p>}
      {d && (
        <>
          <div className="cifras">
            <Cifra titulo="Ventas" valor={pesos(d.ventas)} nota={`${d.dias_con_cierre} días con cierre`} />
            <Cifra titulo="Gastos (sin nómina)" valor={pesos(d.gastos)} />
            <Cifra titulo="Nómina" valor={pesos(d.nomina_total)} nota={d.nomina_pendiente ? `${pesos(d.nomina_pendiente)} por pagar` : 'Al día'} />
            <Cifra titulo="Arriendo apartado" valor={pesos(d.provision_arriendo)} nota={d.arriendo_pagado ? `Ya pagado: ${pesos(d.arriendo_pagado)}` : undefined} />
            <Cifra titulo="Ganancia neta libre" valor={pesos(d.neto)} destacada className={d.neto < 0 ? 'neg' : ''} />
          </div>

          <div className="dos">
            <section className="tarjeta">
              <h2>Gastos del periodo</h2>
              {d.gastos_por_categoria.length ? (
                <div className="tabla-caja" style={{ marginTop: 8 }}>
                  <table><tbody>{d.gastos_por_categoria.map((c) => <tr key={c.categoria}><td>{c.nombre}</td><td className="n">{pesos(c.total)}</td></tr>)}</tbody>
                    <tfoot><tr><td>Total</td><td className="n">{pesos(d.gastos)}</td></tr></tfoot></table>
                </div>
              ) : <p className="vacio">Sin gastos registrados.</p>}
            </section>
            <section className="tarjeta">
              <h2>Cómo se llega a la ganancia neta</h2>
              <div className="ticket" style={{ marginTop: 8 }}>
                <div className="ticket-fila"><span>Ventas</span><strong>{pesos(d.ventas)}</strong></div>
                <div className="ticket-fila"><span>− Gastos</span><strong>{pesos(d.gastos)}</strong></div>
                <div className="ticket-fila"><span>− Nómina</span><strong>{pesos(d.nomina_total)}</strong></div>
                <div className="ticket-fila"><span>− Arriendo apartado</span><strong>{pesos(d.provision_arriendo)}</strong></div>
                <div className="ticket-fila total"><span>Ganancia neta libre</span><strong>{pesos(d.neto)}</strong></div>
              </div>
            </section>
          </div>

          <section className="tarjeta">
            <h2>Nómina</h2>
            <p>Por hora se calcula con los turnos registrados; los sueldos fijos, según la parte del periodo.</p>
            {d.nomina.length ? (
              <div className="tabla-caja" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Trabajador</th><th>Pago</th><th>Cálculo</th><th className="n">Le corresponde</th><th className="n">Pagado</th><th className="n">Pendiente</th>{esAdmin && <th className="n">Pagar ahora</th>}</tr></thead>
                  <tbody>
                    {d.nomina.map((x) => (
                      <tr key={x.id}>
                        <td>{x.nombre}</td><td>{x.tipo_pago}</td><td>{x.detalle}</td><td className="n">{pesos(x.calculado)}</td>
                        <td className="n">{pesos(x.pagado)}</td><td className={`n ${x.pendiente ? 'neg' : 'pos'}`}>{pesos(x.pendiente)}</td>
                        {esAdmin && <td className="n"><input className="entrada precio-celda" type="number" min="0" step="any" value={pagos.nomina[x.id] ?? ''} onChange={(e) => setPagos({ ...pagos, nomina: { ...pagos.nomina, [x.id]: e.target.value } })} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="vacio">No hay trabajadores con pago en este periodo. Regístralos en Personal y turnos.</p>}
            {esAdmin && d.nomina.length > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>{origen}<div><button type="button" className="boton" onClick={() => registrar('nomina', d.nomina)}>Registrar pago de nómina</button></div></div>}
          </section>

          <section className="tarjeta">
            <h2>Reparto entre socios</h2>
            {d.socios.length ? (
              <>
                <div className="tabla-caja" style={{ marginTop: 10 }}>
                  <table>
                    <thead><tr><th>Socio</th><th className="n">%</th><th className="n">Le corresponde</th><th className="n">Ya retiró</th><th className="n">Por pagar</th>{esAdmin && <th className="n">Pagar ahora</th>}</tr></thead>
                    <tbody>
                      {d.socios.map((s) => (
                        <tr key={s.id}>
                          <td>{s.nombre}</td><td className="n">{pct(s.porcentaje)}</td><td className="n">{pesos(s.parte)}</td><td className="n">{pesos(s.retirado)}</td>
                          <td className="n">{pesos(s.por_pagar)}</td>
                          {esAdmin && <td className="n"><input className="entrada precio-celda" type="number" min="0" step="any" value={pagos.socios[s.id] ?? ''} onChange={(e) => setPagos({ ...pagos, socios: { ...pagos.socios, [s.id]: e.target.value } })} /></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.porcentaje_sin_asignar > 0 && <p style={{ marginTop: 8 }} className="aviso info">{pct(d.porcentaje_sin_asignar)} de la ganancia ({pesos(d.sin_asignar)}) no está asignado a ningún socio y queda en el negocio.</p>}
                {d.neto <= 0 && <p style={{ marginTop: 8 }} className="aviso mal">En este periodo no hay ganancia neta para repartir.</p>}
                {esAdmin && d.neto > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>{origen}<div><button type="button" className="boton" onClick={() => registrar('socios', d.socios)}>Registrar pago a socios</button></div></div>}
              </>
            ) : <p className="vacio">Aún no hay socios. Un administrador los agrega en Configuración.</p>}
          </section>

          {esAdmin && <div><button type="button" className="boton secundario" onClick={guardar}>Guardar esta liquidación en el histórico</button></div>}
        </>
      )}

      {(guardadas.datos || []).length > 0 && (
        <section className="tarjeta">
          <h2>Liquidaciones guardadas</h2>
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Periodo</th><th className="n">Ventas</th><th className="n">Gastos</th><th className="n">Nómina</th><th className="n">Neto</th><th /></tr></thead>
              <tbody>
                {guardadas.datos.map((g) => (
                  <tr key={g.id} className="clic" onClick={() => { setClave('otro'); setRango([g.desde, g.hasta, g.tipo]); }}>
                    <td>{fechaCorta(g.desde)} a {fechaCorta(g.hasta)}</td><td className="n">{pesos(g.datos.ventas)}</td><td className="n">{pesos(g.datos.gastos)}</td>
                    <td className="n">{pesos(g.datos.nomina_total)}</td><td className="n">{pesos(g.datos.neto)}</td>
                    <td>{esAdmin && <button type="button" className="boton peligro chico" onClick={(e) => { e.stopPropagation(); borrarGuardada(g.id); }}>Borrar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

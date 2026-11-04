import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Campo, Cifra, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, n, pct, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const COLORES = ['var(--oro)', 'var(--serie-2)', 'var(--serie-4)', 'var(--serie-5)', '#9CCAD8', '#D8C9A6'];

export function calcularReparto(bold, efectivo, pctCaja, bolsillos) {
  const caja = Math.round(efectivo * pctCaja) / 100;
  const transferir = efectivo - caja;
  const ingreso = bold + transferir;
  const partes = bolsillos.map((b) => ({ ...b, monto: Math.round(ingreso * n(b.porcentaje)) / 100 }));
  const aBolsillos = partes.reduce((s, p) => s + p.monto, 0);
  return { total: bold + efectivo, caja, transferir, ingreso, partes, aBolsillos, disponible: ingreso - aBolsillos };
}

export function BarraReparto({ r }) {
  if (!r.total) return null;
  const tramos = [
    { nombre: 'Caja para vueltas', valor: r.caja, color: 'var(--marfil)' },
    ...r.partes.map((p, i) => ({ nombre: p.nombre, valor: p.monto, color: COLORES[i % COLORES.length] })),
    { nombre: 'Disponible en la cuenta', valor: r.disponible, color: 'var(--petroleo)' },
  ];
  return (
    <div>
      <div className="reparto" role="img" aria-label="Reparto del 100% de las ventas del día">
        {tramos.map((t) => <div key={t.nombre} style={{ flexGrow: Math.max(t.valor, 0), background: t.color }} title={`${t.nombre}: ${pesos(t.valor)}`} />)}
      </div>
      <div className="reparto-leyenda">
        {tramos.map((t) => (
          <span key={t.nombre}><i className="muestra" style={{ background: t.color }} />{t.nombre} <strong className="num">{pct((t.valor / r.total) * 100)}</strong></span>
        ))}
      </div>
    </div>
  );
}

export default function Cierre() {
  const [fecha, setFecha] = useState(hoy());
  const [modo, setModo] = useState('saldos');
  const [v, setV] = useState({ inicioBold: '', inicioCaja: '', finalBold: '', finalCaja: '', bold: '', efectivo: '' });
  const [notas, setNotas] = useState('');
  const [existente, setExistente] = useState(null);
  const [sug, setSug] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, avisar] = useMensaje();
  const cfg = useApi('configuracion/');
  const bols = useApi('bolsillos/');
  const mes = fecha.slice(0, 7);
  const { desde, hasta } = rangoMes(mes);
  const delMes = useApi(`cierres/?desde=${desde}&hasta=${hasta}`);
  const cambia = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const texto = (x) => (x == null ? '' : String(n(x)));

  useEffect(() => {
    let vivo = true;
    Promise.all([api(`cierres/?fecha=${fecha}`), api(`cierres/sugerencia/?fecha=${fecha}`)]).then(([lista, s]) => {
      if (!vivo) return;
      const c = lista[0] || null;
      setExistente(c);
      setSug(s);
      setNotas(c?.notas || '');
      if (c) {
        const conSaldos = c.final_bold != null || c.final_caja != null;
        setModo(conSaldos ? 'saldos' : 'ventas');
        setV({ inicioBold: texto(c.inicio_bold), inicioCaja: texto(c.inicio_caja), finalBold: texto(c.final_bold), finalCaja: texto(c.final_caja), bold: texto(c.ventas_bold), efectivo: texto(c.efectivo) });
      } else {
        setV({ inicioBold: '', inicioCaja: s.inicio_caja != null ? String(s.inicio_caja) : '', finalBold: '', finalCaja: '', bold: '', efectivo: '' });
      }
    }).catch(() => {});
    return () => { vivo = false; };
  }, [fecha]);

  const egresosHoy = n(sug?.egresos_caja_hoy);
  const ventasBold = modo === 'saldos' ? (v.finalBold === '' ? 0 : n(v.finalBold) - n(v.inicioBold)) : n(v.bold);
  const ventasEf = modo === 'saldos' ? (v.finalCaja === '' ? 0 : n(v.finalCaja) - n(v.inicioCaja) + egresosHoy) : n(v.efectivo);

  const r = useMemo(() => {
    if (!cfg.datos || !bols.datos) return null;
    const pctCaja = existente ? n(existente.porcentaje_caja) : n(cfg.datos.porcentaje_caja);
    const lista = existente
      ? existente.repartos.map((x) => ({ nombre: x.nombre, porcentaje: x.porcentaje }))
      : bols.datos.filter((b) => b.activo);
    const base = calcularReparto(Math.max(ventasBold, 0), Math.max(ventasEf, 0), pctCaja, lista);
    const queda = modo === 'saldos' && v.finalCaja !== '' ? n(v.finalCaja) - base.transferir : n(v.inicioCaja) + base.caja - egresosHoy;
    return { ...base, pctCaja, queda };
  }, [cfg.datos, bols.datos, existente, ventasBold, ventasEf, modo, v.finalCaja, v.inicioCaja, egresosHoy]);

  const guardar = async (e) => {
    e.preventDefault();
    if (modo === 'saldos' && (ventasBold < 0 || ventasEf < 0)) { avisar('mal', 'Un saldo de cierre quedó menor que el de inicio. Revisa los valores.'); return; }
    if (ventasBold + ventasEf <= 0) { avisar('mal', 'Todavía no hay ventas: revisa los valores del día.'); return; }
    const datos = modo === 'saldos'
      ? { fecha, notas, inicio_bold: n(v.inicioBold), inicio_caja: n(v.inicioCaja), final_bold: v.finalBold === '' ? n(v.inicioBold) : n(v.finalBold), final_caja: v.finalCaja === '' ? n(v.inicioCaja) : n(v.finalCaja) }
      : { fecha, notas, ventas_bold: n(v.bold), efectivo: n(v.efectivo), inicio_bold: n(v.inicioBold), inicio_caja: n(v.inicioCaja), final_bold: null, final_caja: null };
    setGuardando(true);
    try {
      const c = await api('cierres/', { metodo: 'POST', datos });
      setExistente(c);
      avisar('bien', `Cierre del ${fechaCorta(fecha)} guardado.`);
      delMes.recargar();
    } catch (err) {
      avisar('mal', err.message);
    }
    setGuardando(false);
  };

  return (
    <div className="pila">
      <Encabezado titulo="Cierre del día">
        Escribe con cuánto abrió el día en Bold y en caja, y cuánto hay al cerrar. Te decimos cuánto se vendió, cuánto dejar para vueltas, cuánto transferir y cómo se reparte.
      </Encabezado>

      <form className="tarjeta" onSubmit={guardar}>
        <div className="form" style={{ marginBottom: 14 }}>
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={fecha} max={hoy()} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Campo>
          <div className="segmentado" role="group" aria-label="Cómo registrar">
            <button type="button" className={modo === 'saldos' ? 'activo' : ''} onClick={() => setModo('saldos')}>Con saldos de apertura y cierre</button>
            <button type="button" className={modo === 'ventas' ? 'activo' : ''} onClick={() => setModo('ventas')}>Solo ventas del día</button>
          </div>
        </div>
        {modo === 'saldos' ? (
          <div className="dos">
            <div>
              <h3 style={{ marginBottom: 8 }}>Al abrir</h3>
              <div className="form">
                <Campo etiqueta="Saldo en Bold" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.inicioBold} onChange={cambia('inicioBold')} placeholder="0" /></Campo>
                <Campo etiqueta="Efectivo en caja" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.inicioCaja} onChange={cambia('inicioCaja')} placeholder="0" /></Campo>
              </div>
              {!existente && sug?.inicio_caja != null && <small style={{ color: 'var(--texto-suave)' }}>La caja se llenó con lo que debía quedar en el cierre del {fechaCorta(sug.fecha_anterior)}.</small>}
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>Al cerrar</h3>
              <div className="form">
                <Campo etiqueta="Saldo en Bold" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.finalBold} onChange={cambia('finalBold')} /></Campo>
                <Campo etiqueta="Efectivo en caja" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.finalCaja} onChange={cambia('finalCaja')} /></Campo>
              </div>
              {egresosHoy > 0 && <small style={{ color: 'var(--texto-suave)' }}>Hoy se pagaron {pesos(egresosHoy)} de la caja; se suman a las ventas en efectivo.</small>}
            </div>
          </div>
        ) : (
          <div className="form">
            <Campo etiqueta="Ventas en Bold" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.bold} onChange={cambia('bold')} /></Campo>
            <Campo etiqueta="Ventas en efectivo" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.efectivo} onChange={cambia('efectivo')} /></Campo>
            <Campo etiqueta="Efectivo en caja al abrir" className="medio"><input type="number" min="0" step="any" inputMode="decimal" value={v.inicioCaja} onChange={cambia('inicioCaja')} /></Campo>
          </div>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <Campo etiqueta="Notas (opcional)" className="ancho"><input value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} /></Campo>
          <button className="boton" disabled={guardando}>{existente ? 'Actualizar cierre' : 'Guardar cierre'}</button>
        </div>
        {existente && <p style={{ marginTop: 10, color: 'var(--texto-suave)', fontSize: '.86rem' }}>Este día ya tiene cierre (lo registró {existente.creado_por_nombre || 'alguien'}). Se recalcula con los porcentajes con que se guardó.</p>}
        <div style={{ marginTop: 10 }}>{mensaje}</div>
      </form>

      {r && (
        <div className="dos">
          <div className="ticket">
            <h2 style={{ marginBottom: 8 }}>Qué hacer con la plata</h2>
            <div className="ticket-fila total"><span>Ventas del día</span><strong>{pesos(r.total)}</strong></div>
            <div className="ticket-fila sub"><span>Por Bold</span><strong>{pesos(ventasBold)}</strong></div>
            <div className="ticket-fila sub"><span>En efectivo</span><strong>{pesos(ventasEf)}</strong></div>
            <div className="ticket-fila"><span>Deja en caja para vueltas ({pct(r.pctCaja, 0)} del efectivo)</span><strong>{pesos(r.caja)}</strong></div>
            <div className="ticket-fila"><span>Transfiere a la cuenta</span><strong>{pesos(r.transferir)}</strong></div>
            <div className="ticket-fila"><span>Ingreso total a la cuenta (Bold + transferencia)</span><strong>{pesos(r.ingreso)}</strong></div>
            {r.partes.map((p) => (
              <div className="ticket-fila sub" key={p.nombre}><span>Bolsillo {p.nombre} ({pct(p.porcentaje, 1)})</span><strong>{pesos(p.monto)}</strong></div>
            ))}
            <div className="ticket-fila"><span>Queda disponible en la cuenta</span><strong>{pesos(r.disponible)}</strong></div>
            <div className="ticket-fila total"><span>Debe quedar en caja después de transferir</span><strong>{pesos(r.queda)}</strong></div>
          </div>
          <div className="tarjeta">
            <h2>El 100% de las ventas</h2>
            <p>A dónde va cada peso que entró hoy.</p>
            <div style={{ marginTop: 16 }}><BarraReparto r={r} /></div>
            {!r.total && <p className="vacio">Escribe las ventas para ver el reparto.</p>}
          </div>
        </div>
      )}

      <section className="tarjeta">
        <div className="tarjeta-cabeza"><h2>Cierres de este mes</h2></div>
        {delMes.datos?.length ? (
          <div className="tabla-caja">
            <table>
              <thead><tr><th>Fecha</th><th className="n">Bold</th><th className="n">Efectivo</th><th className="n">Total</th><th className="n">Caja vueltas</th><th className="n">A bolsillos</th><th className="n">Disponible</th><th className="n">Queda en caja</th></tr></thead>
              <tbody>
                {delMes.datos.map((c) => (
                  <tr key={c.id} className="clic" onClick={() => setFecha(c.fecha)}>
                    <td>{fechaCorta(c.fecha)}</td><td className="n">{pesos(c.ventas_bold)}</td><td className="n">{pesos(c.efectivo)}</td>
                    <td className="n">{pesos(c.total_ventas)}</td><td className="n">{pesos(c.caja_vueltas)}</td>
                    <td className="n">{pesos(c.a_bolsillos)}</td><td className="n">{pesos(c.disponible_cuenta)}</td><td className="n">{pesos(c.queda_en_caja)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">Todavía no hay cierres este mes. El primero que guardes aparece aquí.</p>}
      </section>

      <div className="cifras">
        <Cifra titulo="Ventas del mes" valor={pesos((delMes.datos || []).reduce((s, c) => s + n(c.total_ventas), 0))} />
        <Cifra titulo="A bolsillos en el mes" valor={pesos((delMes.datos || []).reduce((s, c) => s + n(c.a_bolsillos), 0))} />
        <Cifra titulo="Días con cierre" valor={(delMes.datos || []).length} />
      </div>
    </div>
  );
}

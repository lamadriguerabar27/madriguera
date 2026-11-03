import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Campo, Cifra, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, n, pct, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const COLORES = ['var(--serie-1)', 'var(--serie-3)', 'var(--serie-4)', 'var(--serie-5)', '#5E8C7E', '#A7B88E'];

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
    { nombre: 'Caja para vueltas', valor: r.caja, color: 'var(--maracuya)' },
    ...r.partes.map((p, i) => ({ nombre: p.nombre, valor: p.monto, color: COLORES[i % COLORES.length] })),
    { nombre: 'Disponible en la cuenta', valor: r.disponible, color: '#C9D3C4' },
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
  const [bold, setBold] = useState('');
  const [efectivo, setEfectivo] = useState('');
  const [notas, setNotas] = useState('');
  const [existente, setExistente] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, avisar] = useMensaje();
  const cfg = useApi('configuracion/');
  const bols = useApi('bolsillos/');
  const mes = fecha.slice(0, 7);
  const { desde, hasta } = rangoMes(mes);
  const delMes = useApi(`cierres/?desde=${desde}&hasta=${hasta}`);

  useEffect(() => {
    let vivo = true;
    api(`cierres/?fecha=${fecha}`).then((lista) => {
      if (!vivo) return;
      const c = lista[0] || null;
      setExistente(c);
      setBold(c ? String(n(c.ventas_bold)) : '');
      setEfectivo(c ? String(n(c.efectivo)) : '');
      setNotas(c?.notas || '');
    }).catch(() => {});
    return () => { vivo = false; };
  }, [fecha]);

  const r = useMemo(() => {
    if (!cfg.datos || !bols.datos) return null;
    const pctCaja = existente ? n(existente.porcentaje_caja) : n(cfg.datos.porcentaje_caja);
    const lista = existente
      ? existente.repartos.map((x) => ({ nombre: x.nombre, porcentaje: x.porcentaje }))
      : bols.datos.filter((b) => b.activo);
    return { ...calcularReparto(n(bold), n(efectivo), pctCaja, lista), pctCaja };
  }, [cfg.datos, bols.datos, existente, bold, efectivo]);

  const guardar = async (e) => {
    e.preventDefault();
    if (n(bold) + n(efectivo) <= 0) { avisar('mal', 'Escribe lo que entró por Bold, el efectivo o ambos.'); return; }
    setGuardando(true);
    try {
      const c = await api('cierres/', { metodo: 'POST', datos: { fecha, ventas_bold: n(bold), efectivo: n(efectivo), notas } });
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
        Al cerrar, escribe lo que entró por Bold y el efectivo que hay en caja. Te decimos cuánto dejar para vueltas, cuánto transferir y cómo se reparte.
      </Encabezado>

      <form className="tarjeta" onSubmit={guardar}>
        <div className="form">
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={fecha} max={hoy()} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Campo>
          <Campo etiqueta="Ventas en la cuenta Bold" className="medio"><input type="number" min="0" step="100" inputMode="numeric" value={bold} onChange={(e) => setBold(e.target.value)} /></Campo>
          <Campo etiqueta="Efectivo en caja" className="medio"><input type="number" min="0" step="100" inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} /></Campo>
          <Campo etiqueta="Notas (opcional)" className="ancho"><input value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} /></Campo>
          <button className="boton" disabled={guardando}>{existente ? 'Actualizar cierre' : 'Guardar cierre'}</button>
        </div>
        {existente && <p style={{ marginTop: 10, color: 'var(--tinta-suave)', fontSize: '.88rem' }}>Este día ya tiene cierre (lo registró {existente.creado_por_nombre || 'alguien'}). Se recalcula con los porcentajes con que se guardó.</p>}
        <div style={{ marginTop: 10 }}>{mensaje}</div>
      </form>

      {r && (
        <div className="dos">
          <div className="ticket">
            <h2 style={{ marginBottom: 8 }}>Qué hacer con la plata</h2>
            <div className="ticket-fila total"><span>Ventas del día</span><strong>{pesos(r.total)}</strong></div>
            <div className="ticket-fila"><span>Deja en caja para vueltas ({pct(r.pctCaja, 0)} del efectivo)</span><strong>{pesos(r.caja)}</strong></div>
            <div className="ticket-fila"><span>Transfiere a la cuenta</span><strong>{pesos(r.transferir)}</strong></div>
            <div className="ticket-fila"><span>Ingreso total a la cuenta (Bold + transferencia)</span><strong>{pesos(r.ingreso)}</strong></div>
            {r.partes.map((p) => (
              <div className="ticket-fila sub" key={p.nombre}><span>Bolsillo {p.nombre} ({pct(p.porcentaje, 1)})</span><strong>{pesos(p.monto)}</strong></div>
            ))}
            <div className="ticket-fila"><span>Queda disponible en la cuenta</span><strong>{pesos(r.disponible)}</strong></div>
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
              <thead><tr><th>Fecha</th><th className="n">Bold</th><th className="n">Efectivo</th><th className="n">Total</th><th className="n">Caja vueltas</th><th className="n">A bolsillos</th><th className="n">Disponible</th></tr></thead>
              <tbody>
                {delMes.datos.map((c) => (
                  <tr key={c.id} className="clic" onClick={() => setFecha(c.fecha)}>
                    <td>{fechaCorta(c.fecha)}</td><td className="n">{pesos(c.ventas_bold)}</td><td className="n">{pesos(c.efectivo)}</td>
                    <td className="n">{pesos(c.total_ventas)}</td><td className="n">{pesos(c.caja_vueltas)}</td>
                    <td className="n">{pesos(c.a_bolsillos)}</td><td className="n">{pesos(c.disponible_cuenta)}</td>
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

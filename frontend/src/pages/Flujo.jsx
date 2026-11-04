import { useMemo, useState } from 'react';
import { Barras, Lineas } from '../components/charts.jsx';
import { Cifra, Encabezado, SelectorMes } from '../components/ui.jsx';
import { mesActual, nombreMes, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

export default function Flujo() {
  const [mes, setMes] = useState(mesActual());
  const { desde, hasta } = rangoMes(mes);
  const f = useApi(`reportes/flujo/?desde=${desde}&hasta=${hasta}`);
  const saldos = useApi(`reportes/saldos/?hasta=${hasta}`);
  const hist = useApi('reportes/historico/');
  const d = f.datos;

  const acumulado = useMemo(() => {
    let ing = 0, eg = 0;
    return (d?.serie || []).map((x) => {
      ing += x.ventas; eg += x.egresos;
      return { dia: x.fecha.slice(8), ingresos: ing, egresos: eg };
    });
  }, [d]);

  return (
    <div className="pila">
      <Encabezado titulo="Flujo de caja" acciones={<SelectorMes valor={mes} onChange={setMes} />}>
        Lo que entró por ventas y lo que salió en egresos, y dónde está la plata hoy.
      </Encabezado>
      {f.error && <p className="aviso mal">{f.error}</p>}
      {d && (
        <>
          <div className="cifras">
            <Cifra titulo={`Ventas de ${nombreMes(mes)}`} valor={pesos(d.ventas)} nota={`${d.dias_con_cierre} días con cierre`} destacada />
            <Cifra titulo="Egresos" valor={pesos(d.egresos)} />
            <Cifra titulo="Resultado (ventas − egresos)" valor={pesos(d.resultado)} className={d.resultado >= 0 ? 'pos' : 'neg'} />
            <Cifra titulo="Ingreso a la cuenta" valor={pesos(d.ingreso_cuenta)} nota="Bold más efectivo transferido" />
            <Cifra titulo="A bolsillos" valor={pesos(d.a_bolsillos)} />
            <Cifra titulo="Dejado en caja para vueltas" valor={pesos(d.caja_vueltas)} />
          </div>

          <div className="dos">
            <section className="tarjeta">
              <h2>Ingresos y egresos por día</h2>
              {d.serie.length ? (
                <Barras datos={d.serie.map((x) => ({ ...x, dia: x.fecha.slice(8) }))} x="dia"
                  series={[{ clave: 'ventas', nombre: 'Ventas', color: 'var(--serie-1)' }, { clave: 'egresos', nombre: 'Egresos', color: 'var(--serie-2)' }]} />
              ) : <p className="vacio">Sin movimientos en este mes.</p>}
            </section>
            <section className="tarjeta">
              <h2>Acumulado del mes</h2>
              {acumulado.length ? (
                <Lineas datos={acumulado} x="dia"
                  series={[{ clave: 'ingresos', nombre: 'Ventas acumuladas', color: 'var(--serie-1)' }, { clave: 'egresos', nombre: 'Egresos acumulados', color: 'var(--serie-2)' }]} />
              ) : <p className="vacio">Sin movimientos en este mes.</p>}
            </section>
          </div>

          <div className="dos">
            <section className="tarjeta">
              <h2>En qué se fue la plata</h2>
              {d.egresos_por_categoria.length ? (
                <Barras horizontal alto={Math.max(160, d.egresos_por_categoria.length * 44)} datos={d.egresos_por_categoria} x="nombre"
                  series={[{ clave: 'total', nombre: 'Egresos', color: 'var(--serie-2)' }]} />
              ) : <p className="vacio">No hay egresos en este mes.</p>}
            </section>
            <section className="tarjeta">
              <h2>Entradas y salidas del mes por lugar</h2>
              <TablaOrigen filas={d.egresos_por_origen} />
            </section>
          </div>
        </>
      )}

      <section className="tarjeta">
        <h2>Dónde está la plata hoy</h2>
        <p>Saldos acumulados desde el primer cierre hasta el final de {nombreMes(mes)}. No incluye los rendimientos que paga el banco.</p>
        {saldos.datos && <div style={{ marginTop: 10 }}><TablaOrigen filas={saldos.datos} /></div>}
      </section>

      <section className="tarjeta">
        <h2>Histórico mensual</h2>
        {hist.datos?.length ? (
          <>
            <Barras datos={[...hist.datos].reverse()} x="mes"
              series={[{ clave: 'ventas', nombre: 'Ventas', color: 'var(--serie-1)' }, { clave: 'egresos', nombre: 'Egresos', color: 'var(--serie-2)' }]} />
            <div className="tabla-caja" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Mes</th><th className="n">Ventas</th><th className="n">Ingreso cuenta</th><th className="n">A bolsillos</th><th className="n">Caja vueltas</th><th className="n">Egresos</th><th className="n">Resultado</th></tr></thead>
                <tbody>
                  {hist.datos.map((h) => (
                    <tr key={h.mes} className="clic" onClick={() => setMes(h.mes)}>
                      <td>{nombreMes(h.mes)}</td><td className="n">{pesos(h.ventas)}</td><td className="n">{pesos(h.ingreso_cuenta)}</td>
                      <td className="n">{pesos(h.a_bolsillos)}</td><td className="n">{pesos(h.caja_vueltas)}</td><td className="n">{pesos(h.egresos)}</td>
                      <td className={`n ${h.resultado >= 0 ? 'pos' : 'neg'}`}>{pesos(h.resultado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="vacio">El histórico se arma solo a medida que registren cierres y egresos.</p>}
      </section>
    </div>
  );
}

function TablaOrigen({ filas }) {
  return (
    <div className="tabla-caja">
      <table>
        <thead><tr><th>Lugar</th><th className="n">Entró</th><th className="n">Salió</th><th className="n">Saldo</th></tr></thead>
        <tbody>
          {filas.map((o) => (
            <tr key={o.clave}><td>{o.nombre}</td><td className="n">{pesos(o.entra)}</td><td className="n">{pesos(o.sale)}</td><td className={`n ${o.saldo >= 0 ? '' : 'neg'}`}>{pesos(o.saldo)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

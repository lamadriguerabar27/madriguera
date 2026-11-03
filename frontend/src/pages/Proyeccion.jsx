import { Barras } from '../components/charts.jsx';
import { Cifra, Encabezado } from '../components/ui.jsx';
import { pct, pesos } from '../format.js';
import { useApi } from '../hooks.js';

export default function Proyeccion() {
  const { datos: d, error } = useApi('reportes/proyeccion/');
  if (error) return <p className="aviso mal">{error}</p>;
  if (!d) return <p className="vacio">Cargando…</p>;
  const cubre = d.bolsillo_arriendo != null && d.bolsillo_arriendo >= d.arriendo_mensual;
  return (
    <div className="pila">
      <Encabezado titulo="Metas y rendimiento">
        Con la meta de ventas que definió un administrador, cuánto llega a cada bolsillo y cuánto rinde al año.
      </Encabezado>
      {d.bolsillo_arriendo != null && (
        <p className={`aviso ${cubre ? 'bien' : 'mal'}`}>
          {cubre
            ? `Con esta meta el bolsillo de arriendo junta ${pesos(d.bolsillo_arriendo)} al mes y cubre los ${pesos(d.arriendo_mensual)}.`
            : `Con esta meta el bolsillo de arriendo junta ${pesos(d.bolsillo_arriendo)} al mes; le faltan ${pesos(d.arriendo_mensual - d.bolsillo_arriendo)}. La meta que lo cubre es ${pesos(d.meta_para_arriendo)}.`}
        </p>
      )}
      <div className="cifras">
        <Cifra titulo="Meta mensual" valor={pesos(d.meta_mensual)} destacada />
        <Cifra titulo="Meta diaria" valor={pesos(d.meta_diaria)} nota={`${d.dias_abiertos} días abiertos`} />
        <Cifra titulo="A bolsillos al mes" valor={pesos(d.a_bolsillos_mensual)} nota={`Se estima que ${pct(d.parte_efectivo * 100, 0)} de las ventas es efectivo`} />
        <Cifra titulo="Rendimiento del primer mes" valor={pesos(d.rendimiento_mes1)} />
        <Cifra titulo="Rendimiento en 12 meses" valor={pesos(d.rendimiento_12m)} />
      </div>
      <section className="tarjeta">
        <h2>Rendimiento en 12 meses por bolsillo</h2>
        <p>Los bolsillos que se vacían cada mes rinden poco; los que acumulan rinden cada vez más.</p>
        <Barras horizontal alto={Math.max(180, d.bolsillos.length * 48)} datos={d.bolsillos} x="nombre"
          series={[{ clave: 'rendimiento_12m', nombre: 'Rendimiento 12 meses', color: 'var(--serie-1)' }]} />
      </section>
      <section className="tarjeta">
        <h2>Detalle por bolsillo</h2>
        <div className="tabla-caja" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Bolsillo</th><th className="n">%</th><th className="n">Aporte mensual</th><th className="n">Aporte diario</th><th className="n">Rend. mes 1</th><th className="n">Rend. 12 meses</th><th className="n">Saldo a 12 meses</th></tr></thead>
            <tbody>
              {d.bolsillos.map((b) => (
                <tr key={b.id}>
                  <td>{b.nombre}</td><td className="n">{pct(b.porcentaje)}</td><td className="n">{pesos(b.aporte_mensual)}</td><td className="n">{pesos(b.aporte_diario)}</td>
                  <td className="n">{pesos(b.rendimiento_mes1)}</td><td className="n">{pesos(b.rendimiento_12m)}</td>
                  <td className="n">{b.saldo_12m == null ? 'Se usa cada mes' : pesos(b.saldo_12m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 10, color: 'var(--texto-suave)', fontSize: '.88rem' }}>
          Supone que las ventas entran parejo durante el mes, que la tasa se mantiene ({pct((Math.pow(1 + d.tasa_mensual, 12) - 1) * 100, 1)} E.A.) y que el efectivo dejado en caja no pasa por los bolsillos.
        </p>
      </section>
    </div>
  );
}

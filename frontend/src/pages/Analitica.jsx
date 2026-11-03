import { useMemo, useState } from 'react';
import { Barras, Lineas } from '../components/charts.jsx';
import { Campo, Cifra, Encabezado } from '../components/ui.jsx';
import { mesActual, pct, pesos, rangoMes } from '../format.js';
import { useApi } from '../hooks.js';

const ORDENES = { cantidad: 'Unidades', ingresos: 'Ventas', utilidad: 'Utilidad', margen: 'Margen' };

export default function Analitica() {
  const inicial = rangoMes(mesActual());
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [orden, setOrden] = useState('cantidad');
  const { datos: d, error } = useApi(`analitica/productos/?desde=${desde}&hasta=${hasta}`);
  const productos = useMemo(() => [...(d?.productos || [])].sort((a, b) => (b[orden] ?? -1) - (a[orden] ?? -1)), [d, orden]);
  const top = productos.slice(0, 10);

  return (
    <div className="pila">
      <Encabezado titulo="Productos más vendidos"
        acciones={(
          <div className="form">
            <Campo etiqueta="Desde" className="medio"><input type="date" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></Campo>
            <Campo etiqueta="Hasta" className="medio"><input type="date" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} /></Campo>
          </div>
        )}>
        Qué se vende más, qué deja más plata y cómo va cada categoría.
      </Encabezado>
      {error && <p className="aviso mal">{error}</p>}
      {d && (
        d.productos.length ? (
          <>
            <div className="cifras">
              <Cifra titulo="Unidades vendidas" valor={d.totales.cantidad.toLocaleString('es-CO')} destacada />
              <Cifra titulo="Ventas" valor={pesos(d.totales.ingresos)} />
              <Cifra titulo="Costo de lo vendido" valor={pesos(d.totales.costo)} />
              <Cifra titulo="Utilidad bruta" valor={pesos(d.totales.utilidad)} nota={`Margen ${pct(d.totales.margen)}`} />
            </div>
            <div className="dos">
              <section className="tarjeta">
                <div className="tarjeta-cabeza">
                  <h2>Top 10 por {ORDENES[orden].toLowerCase()}</h2>
                  <Campo etiqueta="Ordenar por" className="medio">
                    <select value={orden} onChange={(e) => setOrden(e.target.value)}>
                      {Object.entries(ORDENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Campo>
                </div>
                <Barras horizontal alto={Math.max(200, top.length * 34)} datos={top} x="nombre"
                  formato={orden === 'cantidad' ? (v) => `${v} und` : orden === 'margen' ? (v) => pct(v, 0) : undefined}
                  series={[{ clave: orden, nombre: ORDENES[orden], color: 'var(--serie-1)' }]} />
              </section>
              <section className="tarjeta">
                <h2>Por categoría</h2>
                <Barras datos={d.categorias} x="nombre"
                  series={[{ clave: 'ingresos', nombre: 'Ventas', color: 'var(--serie-1)' }, { clave: 'utilidad', nombre: 'Utilidad', color: 'var(--serie-2)' }]} />
              </section>
            </div>
            <section className="tarjeta">
              <h2>Ventas y utilidad por día</h2>
              <Lineas datos={d.serie.map((x) => ({ ...x, dia: x.fecha.slice(5) }))} x="dia"
                series={[{ clave: 'ingresos', nombre: 'Ventas', color: 'var(--serie-1)' }, { clave: 'utilidad', nombre: 'Utilidad', color: 'var(--serie-2)' }]} />
            </section>
            <section className="tarjeta">
              <h2>Todos los productos</h2>
              <div className="tabla-caja" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Producto</th><th>Categoría</th><th className="n">Unidades</th><th className="n">Ventas</th><th className="n">Costo</th><th className="n">Utilidad</th><th className="n">Margen</th></tr></thead>
                  <tbody>
                    {productos.map((p) => (
                      <tr key={p.producto}>
                        <td>{p.nombre}</td><td>{p.categoria_nombre}</td><td className="n">{p.cantidad}</td><td className="n">{pesos(p.ingresos)}</td>
                        <td className="n">{pesos(p.costo)}</td><td className="n">{pesos(p.utilidad)}</td>
                        <td className={`n ${p.margen != null && p.margen < 30 ? 'neg' : ''}`}>{pct(p.margen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : <p className="vacio">No hay ventas por producto en estas fechas. Regístralas en Ventas por producto.</p>
      )}
    </div>
  );
}

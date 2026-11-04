import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { hoy, n, pesos } from '../format.js';
import { useApi } from '../hooks.js';

export default function Ventas() {
  const { esAdmin } = useAuth();
  const [fecha, setFecha] = useState(hoy());
  const [cant, setCant] = useState({});
  const [filtro, setFiltro] = useState('');
  const [mensaje, avisar] = useMensaje();
  const [archivo, setArchivo] = useState(null);
  const [borrando, setBorrando] = useState(null);
  const productos = useApi('productos/?activos=1');
  const delDia = useApi(`ventas-producto/?fecha=${fecha}`);

  const grupos = useMemo(() => {
    const g = {};
    for (const p of productos.datos || []) {
      if (filtro && !p.nombre.toLowerCase().includes(filtro.toLowerCase())) continue;
      (g[p.categoria_nombre] ||= []).push(p);
    }
    return Object.entries(g);
  }, [productos.datos, filtro]);

  const items = Object.entries(cant).filter(([, c]) => n(c) > 0).map(([id, c]) => ({ producto: Number(id), cantidad: Math.round(n(c)) }));
  const totalNuevo = items.reduce((s, i) => s + i.cantidad * n((productos.datos || []).find((p) => p.id === i.producto)?.precio_venta), 0);

  const guardar = async () => {
    if (!items.length) { avisar('mal', 'Escribe la cantidad vendida de al menos un producto.'); return; }
    try {
      await api('ventas-producto/', { metodo: 'POST', datos: { fecha, items } });
      setCant({});
      avisar('bien', `${items.length} producto(s) registrados. El inventario ya se descontó.`);
      delDia.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const importar = async () => {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('fecha', fecha);
    try {
      const r = await api('ventas-producto/importar/', { metodo: 'POST', archivo: fd });
      avisar('bien', `Se importaron ${r.registradas} líneas de ventas.`);
      setArchivo(null);
      delDia.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const [edit, setEdit] = useState({});
  const guardarEdicion = async (v) => {
    const c = edit[v.id];
    if (!c || Number(c) === v.cantidad) { setEdit({ ...edit, [v.id]: undefined }); return; }
    try {
      await api(`ventas-producto/${v.id}/`, { metodo: 'PATCH', datos: { cantidad: Math.round(n(c)) } });
      setEdit({ ...edit, [v.id]: undefined }); delDia.recargar(); avisar('bien', 'Venta corregida; el inventario se ajustó.');
    } catch (err) { avisar('mal', err.message); }
  };

  const borrar = async (id) => {
    if (borrando !== id) { setBorrando(id); return; }
    try { await api(`ventas-producto/${id}/`, { metodo: 'DELETE' }); delDia.recargar(); avisar('bien', 'Venta borrada y devuelta al inventario.'); } catch (err) { avisar('mal', err.message); }
    setBorrando(null);
  };

  const vendidas = delDia.datos || [];
  return (
    <div className="pila">
      <Encabezado titulo="Ventas por producto">
        Registra cuántas unidades vendieron de cada producto. Con esto se arma la analítica y se descuenta el inventario según cada receta.
      </Encabezado>
      <section className="tarjeta">
        <div className="form" style={{ marginBottom: 14 }}>
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={fecha} max={hoy()} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Campo>
          <Campo etiqueta="Buscar producto" className="ancho"><input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Ej.: mojito" /></Campo>
        </div>
        {!productos.datos?.length && !productos.cargando && <p className="vacio">Aún no hay productos en la carta. Un administrador puede crearlos en Carta y costeo.</p>}
        {grupos.map(([cat, lista]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 6 }}>{cat}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {lista.map((p) => (
                <label key={p.id} className="campo" style={{ border: '1px solid var(--linea)', borderRadius: 8, padding: 8 }}>
                  <span style={{ color: 'var(--texto)' }}>{p.nombre} <small style={{ color: 'var(--texto-suave)' }}>{pesos(p.precio_venta)}</small></span>
                  <input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={cant[p.id] || ''} onChange={(e) => setCant({ ...cant, [p.id]: e.target.value })} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="form" style={{ justifyContent: 'space-between' }}>
          <p>Total a registrar: <strong className="num">{pesos(totalNuevo)}</strong></p>
          <button type="button" className="boton" onClick={guardar}>Registrar ventas</button>
        </div>
        <div style={{ marginTop: 10 }}>{mensaje}</div>
      </section>

      <section className="tarjeta">
        <h2>Importar desde un archivo</h2>
        <p>Si tu datáfono o sistema exporta las ventas, sube un .csv con las columnas <code>producto</code> y <code>cantidad</code> (opcionales: <code>precio</code> y <code>fecha</code> AAAA-MM-DD). Los nombres deben ser iguales a los de la carta.</p>
        <div className="form" style={{ marginTop: 10 }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
          <button type="button" className="boton secundario" disabled={!archivo} onClick={importar}>Importar</button>
        </div>
      </section>

      <section className="tarjeta">
        <h2>Vendido este día</h2>
        {vendidas.length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Producto</th><th className="n">Cantidad</th><th className="n">Precio</th><th className="n">Total</th><th className="n">Utilidad</th>{esAdmin && <th />}</tr></thead>
              <tbody>
                {vendidas.map((v) => (
                  <tr key={v.id}>
                    <td>{v.producto_nombre}</td>
                    <td className="n">{esAdmin ? (
                      <input className="entrada precio-celda" style={{ width: 80 }} type="number" min="1" step="1" value={edit[v.id] ?? v.cantidad}
                        onChange={(e) => setEdit({ ...edit, [v.id]: e.target.value })} onBlur={() => guardarEdicion(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Cantidad" />
                    ) : v.cantidad}</td><td className="n">{pesos(v.precio_unitario)}</td>
                    <td className="n">{pesos(v.total)}</td><td className="n">{pesos(v.utilidad)}</td>
                    {esAdmin && <td><button type="button" className="boton peligro chico" onClick={() => borrar(v.id)}>{borrando === v.id ? 'Confirmar' : 'Borrar'}</button></td>}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="n">{vendidas.reduce((s, v) => s + v.cantidad, 0)}</td><td /><td className="n">{pesos(vendidas.reduce((s, v) => s + n(v.total), 0))}</td><td className="n">{pesos(vendidas.reduce((s, v) => s + n(v.utilidad), 0))}</td>{esAdmin && <td />}</tr></tfoot>
            </table>
          </div>
        ) : <p className="vacio">No hay ventas por producto registradas en esta fecha.</p>}
      </section>
    </div>
  );
}

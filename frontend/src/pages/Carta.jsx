import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { costoDirecto, costoReceta, margenReal, precioConMargen } from '../costeo.js';
import { n, pct, pesos, UNIDAD } from '../format.js';
import { useApi } from '../hooks.js';

const NUEVO = {
  nombre: '', categoria: '', tipo: 'receta', costo_compra: '', unidades_por_compra: '1', descripcion: '',
  precio_venta: '', margen_objetivo: '', activo: true, receta: [],
};
const redondear1 = (v) => Math.round(v * 10) / 10;

export default function Carta() {
  const { esAdmin } = useAuth();
  const productos = useApi('productos/');
  const insumos = useApi('insumos/?activos=1');
  const cfg = useApi('configuracion/');
  const ops = useApi('opciones/costos/');
  const [p, setP] = useState(null);
  const [precios, setPrecios] = useState({});
  const [mensaje, avisar] = useMensaje();

  const lista = productos.datos || [];
  const ins = insumos.datos || [];
  const margenCfg = n(cfg.datos?.margen_objetivo ?? 40);
  const redondeo = n(cfg.datos?.redondeo_precio ?? 500);
  const catsProducto = ops.datos?.categorias_producto || [];

  const abrir = (prod) => {
    setP(prod ? {
      ...prod,
      precio_venta: String(n(prod.precio_venta)),
      // Al abrir se muestra la ganancia real con el precio actual; si no tiene precio, la meta guardada.
      margen_objetivo: n(prod.precio_venta) > 0 && prod.costeo?.margen_actual != null
        ? String(Math.round(prod.costeo.margen_actual * 10) / 10)
        : prod.margen_objetivo == null ? '' : String(n(prod.margen_objetivo)),
      costo_compra: prod.costo_compra == null ? '' : String(n(prod.costo_compra)),
      unidades_por_compra: String(n(prod.unidades_por_compra) || 1),
      receta: prod.receta.map((r) => ({ insumo: String(r.insumo), cantidad: String(n(r.cantidad)) })),
    } : { ...NUEVO, categoria: catsProducto[0]?.valor || '', margen_objetivo: String(margenCfg) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const guardar = async () => {
    const m = p.margen_objetivo === '' ? null : Math.min(95, Math.max(0, n(p.margen_objetivo)));
    const datos = {
      nombre: p.nombre, categoria: p.categoria, tipo: p.tipo, descripcion: p.descripcion || '', activo: p.activo,
      precio_venta: n(p.precio_venta), margen_objetivo: m,
      costo_compra: p.tipo === 'reventa' ? n(p.costo_compra) : null,
      unidades_por_compra: p.tipo === 'reventa' ? n(p.unidades_por_compra) || 1 : 1,
      receta: p.receta.filter((r) => r.insumo && n(r.cantidad) > 0).map((r) => ({ insumo: Number(r.insumo), cantidad: n(r.cantidad) })),
    };
    try {
      const r = await api(p.id ? `productos/${p.id}/` : 'productos/', { metodo: p.id ? 'PUT' : 'POST', datos });
      avisar('bien', `«${r.nombre}» guardado.`);
      productos.recargar();
      abrir(r);
    } catch (err) { avisar('mal', err.message); }
  };

  const borrar = async () => {
    try {
      const r = await api(`productos/${p.id}/`, { metodo: 'DELETE' });
      avisar('bien', r?.detail || 'Producto borrado.');
      setP(null);
      productos.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const guardarPrecio = async (x) => {
    const valor = precios[x.id];
    if (valor === undefined || n(valor) === n(x.precio_venta)) return;
    try {
      await api(`productos/${x.id}/`, { metodo: 'PATCH', datos: { precio_venta: n(valor) } });
      setPrecios({ ...precios, [x.id]: undefined });
      productos.recargar();
      avisar('bien', `Precio de «${x.nombre}» actualizado.`);
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <div className="pila">
      <Encabezado titulo="Carta, costos y precios" acciones={esAdmin && <button type="button" className="boton" onClick={() => abrir(null)}>Nuevo producto</button>}>
        Para cada producto: cuánto te cuesta, a cuánto lo vendes y cuánto ganas. Si cambias el precio te decimos el porcentaje de ganancia, y si cambias el porcentaje te decimos el precio.
      </Encabezado>
      {mensaje}
      {p && (
        <Editor p={p} setP={setP} ins={ins} esAdmin={esAdmin} margenCfg={margenCfg} redondeo={redondeo} ops={ops.datos}
          onGuardar={guardar} onBorrar={borrar} onCerrar={() => setP(null)} onInsumoNuevo={() => insumos.recargar()} avisar={avisar} />
      )}
      <section className="tarjeta">
        <h2>Productos</h2>
        <p>{esAdmin ? 'Puedes cambiar el precio directamente en la tabla; se guarda al salir del campo.' : 'Toca un producto para ver su costo.'}</p>
        {lista.length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Producto</th><th>Categoría</th><th className="n">Costo</th><th className="n">Precio de venta</th><th className="n">Ganancia</th><th className="n">% ganancia</th><th /></tr></thead>
              <tbody>
                {lista.map((x) => {
                  const precio = precios[x.id] !== undefined ? n(precios[x.id]) : n(x.precio_venta);
                  const m = margenReal(precio, x.costeo.costo);
                  const bajo = m != null && m < x.costeo.margen_objetivo - 0.5;
                  return (
                    <tr key={x.id} className="clic" onClick={() => abrir(x)}>
                      <td>{x.nombre}{!x.activo && <span className="etiqueta" style={{ marginLeft: 6 }}>Inactivo</span>}
                        {x.tipo === 'reventa' && <span className="etiqueta" style={{ marginLeft: 6 }}>Reventa</span>}</td>
                      <td>{x.categoria_nombre}</td>
                      <td className="n">{pesos(x.costeo.costo)}</td>
                      <td className="n" onClick={(e) => esAdmin && e.stopPropagation()}>
                        {esAdmin ? (
                          <input className="entrada precio-celda" type="number" min="0" step="any" value={precios[x.id] ?? n(x.precio_venta)}
                            onChange={(e) => setPrecios({ ...precios, [x.id]: e.target.value })} onBlur={() => guardarPrecio(x)}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Precio de ${x.nombre}`} />
                        ) : pesos(x.precio_venta)}
                      </td>
                      <td className={`n ${precio - x.costeo.costo >= 0 ? '' : 'neg'}`}>{pesos(precio - x.costeo.costo)}</td>
                      <td className={`n ${bajo ? 'neg' : 'pos'}`}>{pct(m)}</td>
                      <td>{bajo && <span className="etiqueta alerta">Bajo la meta</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">Aún no hay productos. {esAdmin ? 'Crea el primero con «Nuevo producto».' : ''}</p>}
      </section>
    </div>
  );
}

function Editor({ p, setP, ins, esAdmin, margenCfg, redondeo, ops, onGuardar, onBorrar, onCerrar, onInsumoNuevo, avisar }) {
  const [rapido, setRapido] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const directo = costoDirecto(p);
  const extras = useMemo(() => costoReceta(p.receta, ins), [p.receta, ins]);
  const costo = directo + extras;
  const precio = n(p.precio_venta);
  const real = margenReal(precio, costo);
  const set = (k, v) => setP({ ...p, [k]: v });
  const usados = new Set(p.receta.map((r) => String(r.insumo)));
  const cats = ops?.categorias_insumo || [];
  const reventa = p.tipo === 'reventa';

  // Precio y % de ganancia se calculan el uno del otro.
  const cambiarMargen = (v) => setP({ ...p, margen_objetivo: v, precio_venta: v === '' ? p.precio_venta : String(precioConMargen(costo, v)) });
  const cambiarPrecio = (v) => {
    const m = margenReal(n(v), costo);
    setP({ ...p, precio_venta: v, margen_objetivo: m == null ? p.margen_objetivo : String(redondear1(m)) });
  };
  // Si cambia el costo y aún no hay precio, el precio sale del %; si ya hay precio, se recalcula el %.
  const conCosto = (cambios) => {
    const nuevo = { ...p, ...cambios };
    const c = costoDirecto(nuevo) + costoReceta(nuevo.receta, ins);
    if (!n(nuevo.precio_venta) && nuevo.margen_objetivo !== '') {
      setP({ ...nuevo, precio_venta: c > 0 ? String(precioConMargen(c, nuevo.margen_objetivo)) : '' });
      return;
    }
    const m = margenReal(n(nuevo.precio_venta), c);
    setP({ ...nuevo, margen_objetivo: m == null ? nuevo.margen_objetivo : String(redondear1(m)) });
  };

  const crearInsumo = async () => {
    try {
      const nuevo = await api('insumos/', { metodo: 'POST', datos: { ...rapido, costo_unitario: n(rapido.costo_unitario), controla_stock: rapido.categoria !== 'servicio' } });
      onInsumoNuevo();
      conCosto({ receta: [...p.receta, { insumo: String(nuevo.id), cantidad: '1' }] });
      setRapido(null);
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <section className="tarjeta">
      <div className="tarjeta-cabeza">
        <h2>{p.id ? p.nombre || 'Producto' : 'Nuevo producto'}</h2>
        <button type="button" className="enlace" onClick={onCerrar}>Cerrar</button>
      </div>
      <fieldset disabled={!esAdmin} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form">
          <Campo etiqueta="Nombre" className="ancho"><input value={p.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Mojito, Cerveza Club Colombia" /></Campo>
          <Campo etiqueta="Categoría" className="medio">
            <select value={p.categoria} onChange={(e) => set('categoria', e.target.value)}>
              {(ops?.categorias_producto || []).map((c) => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
            </select>
          </Campo>
          <label className="check"><input type="checkbox" checked={p.activo} onChange={(e) => set('activo', e.target.checked)} /> En la carta</label>
        </div>

        <div style={{ margin: '16px 0 8px' }}>
          <div className="segmentado" role="group" aria-label="Tipo de producto">
            <button type="button" className={!reventa ? 'activo' : ''} onClick={() => conCosto({ tipo: 'receta' })}>Lo preparo con insumos</button>
            <button type="button" className={reventa ? 'activo' : ''} onClick={() => conCosto({ tipo: 'reventa' })}>Lo compro y lo vendo tal cual</button>
          </div>
        </div>

        {reventa && (
          <div className="calc" style={{ marginBottom: 12 }}>
            <Campo etiqueta="Lo que pagas por la presentación"><input type="number" min="0" step="any" value={p.costo_compra} onChange={(e) => conCosto({ costo_compra: e.target.value })} placeholder="Ej.: 60000 la caja" /></Campo>
            <Campo etiqueta="Unidades que trae"><input type="number" min="0" step="any" value={p.unidades_por_compra} onChange={(e) => conCosto({ unidades_por_compra: e.target.value })} placeholder="Ej.: 24" /></Campo>
            <div className="ticket-fila" style={{ border: 0 }}><span>Costo por unidad</span><strong>{pesos(directo)}</strong></div>
          </div>
        )}

        <h3 style={{ margin: '12px 0 6px' }}>{reventa ? 'Extras que entregas con cada unidad (opcional)' : 'Qué lleva'}</h3>
        {reventa && <p style={{ color: 'var(--texto-suave)', fontSize: '.85rem', marginBottom: 6 }}>Ej.: servilleta, envío, limón. Se suman al costo.</p>}
        {p.receta.length > 0 && (
          <div className="receta-fila" style={{ color: 'var(--texto-suave)', fontSize: '.8rem' }}>
            <span>Insumo</span><span>Cantidad</span><span style={{ textAlign: 'right' }}>Costo</span><span />
          </div>
        )}
        {p.receta.map((r, i) => {
          const insumo = ins.find((x) => x.id === Number(r.insumo));
          return (
            <div className="receta-fila" key={i}>
              <select className="entrada" value={r.insumo} onChange={(e) => conCosto({ receta: p.receta.map((x, j) => (j === i ? { ...x, insumo: e.target.value } : x)) })}>
                <option value="">Elige un insumo</option>
                {cats.map((c) => {
                  const del = ins.filter((x) => x.categoria === c.valor && (!usados.has(String(x.id)) || String(x.id) === String(r.insumo)));
                  return del.length ? (
                    <optgroup key={c.valor} label={c.nombre}>
                      {del.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {pesos(x.costo_unitario)}/{UNIDAD[x.unidad]}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input className="entrada" type="number" min="0" step="any" value={r.cantidad} onChange={(e) => conCosto({ receta: p.receta.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)) })} />
                <small>{insumo ? UNIDAD[insumo.unidad] : ''}</small>
              </div>
              <strong className="num" style={{ textAlign: 'right' }}>{pesos(n(r.cantidad) * n(insumo?.costo_unitario))}</strong>
              <button type="button" className="boton peligro chico" aria-label="Quitar" onClick={() => conCosto({ receta: p.receta.filter((_, j) => j !== i) })}>×</button>
            </div>
          );
        })}
        {esAdmin && (
          <div className="form" style={{ marginTop: 8 }}>
            <button type="button" className="boton secundario chico" onClick={() => set('receta', [...p.receta, { insumo: '', cantidad: '1' }])}>Agregar insumo</button>
            <button type="button" className="boton secundario chico" onClick={() => setRapido({ nombre: '', categoria: cats[0]?.valor || '', unidad: 'unidad', costo_unitario: '' })}>Crear insumo nuevo</button>
          </div>
        )}
        {rapido && (
          <div className="tarjeta" style={{ marginTop: 10, background: 'var(--superficie-2)' }}>
            <p style={{ marginBottom: 8 }}>Para algo sencillo: nombre, en qué se mide y cuánto cuesta cada unidad. Para botellas usa Insumos e inventario, donde pones el precio de la botella y sus ml.</p>
            <div className="form">
              <Campo etiqueta="Nombre" className="ancho"><input value={rapido.nombre} onChange={(e) => setRapido({ ...rapido, nombre: e.target.value })} placeholder="Ej.: Servilleta, Envío" /></Campo>
              <Campo etiqueta="Categoría" className="medio">
                <select value={rapido.categoria} onChange={(e) => setRapido({ ...rapido, categoria: e.target.value })}>
                  {cats.map((c) => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Se mide en" className="corto">
                <select value={rapido.unidad} onChange={(e) => setRapido({ ...rapido, unidad: e.target.value })}>
                  {(ops?.unidades || []).map((u) => <option key={u.valor} value={u.valor}>{u.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Costo por unidad" className="medio"><input type="number" min="0" step="any" value={rapido.costo_unitario} onChange={(e) => setRapido({ ...rapido, costo_unitario: e.target.value })} /></Campo>
              <button type="button" className="boton chico" onClick={crearInsumo} disabled={!rapido.nombre}>Crear y agregar</button>
              <button type="button" className="enlace" onClick={() => setRapido(null)}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="ticket" style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 10 }}>Precio y ganancia</h3>
          <div className="calc">
            <div>
              <span style={{ color: 'var(--texto-suave)', fontSize: '.82rem' }}>Te cuesta cada unidad</span>
              <div className="precio-grande" style={{ fontSize: '1.8rem' }}>{pesos(costo)}</div>
              {reventa && extras > 0 && <small style={{ color: 'var(--texto-suave)' }}>{pesos(directo)} + {pesos(extras)} de extras</small>}
            </div>
            <Campo etiqueta="% de ganancia (sobre el precio)"><input type="number" step="any" value={p.margen_objetivo} onChange={(e) => cambiarMargen(e.target.value)} /></Campo>
            <Campo etiqueta="Precio de venta"><input type="number" min="0" step="any" value={p.precio_venta} onChange={(e) => cambiarPrecio(e.target.value)} /></Campo>
          </div>
          <div className="ticket-fila" style={{ marginTop: 12 }}><span>Ganas por unidad</span><strong className={precio - costo >= 0 ? 'pos' : 'neg'}>{pesos(precio - costo)}</strong></div>
          <div className="ticket-fila"><span>Ganancia sobre el precio</span><strong className={real != null && real < margenCfg - 0.5 ? 'neg' : 'pos'}>{pct(real)}</strong></div>
          <div className="ticket-fila"><span>Equivale a sumarle al costo</span><strong>{costo > 0 && precio > 0 ? pct(((precio - costo) / costo) * 100) : '—'}</strong></div>
          {costo > 0 && (
            <div className="form" style={{ marginTop: 10 }}>
              {esAdmin && redondeo > 0 && precio > 0 && precio % redondeo !== 0 && (
                <button type="button" className="boton secundario chico" onClick={() => cambiarPrecio(String(Math.ceil(precio / redondeo) * redondeo))}>Redondear a {pesos(Math.ceil(precio / redondeo) * redondeo)}</button>
              )}
              {esAdmin && (
                <button type="button" className="boton secundario chico" onClick={() => cambiarMargen(String(margenCfg))}>Usar el margen general ({pct(margenCfg, 0)}): {pesos(precioConMargen(costo, margenCfg))}</button>
              )}
            </div>
          )}
          {real != null && real < 0 && <p className="aviso mal" style={{ marginTop: 10 }}>Con este precio pierdes plata en cada unidad.</p>}
        </div>

        {esAdmin && (
          <div className="form" style={{ marginTop: 16 }}>
            <button type="button" className="boton" onClick={onGuardar} disabled={!p.nombre || !p.categoria}>Guardar producto</button>
            {p.id && <button type="button" className="boton peligro" onClick={() => (confirmar ? onBorrar() : setConfirmar(true))}>{confirmar ? 'Confirmar borrado' : 'Borrar producto'}</button>}
          </div>
        )}
      </fieldset>
    </section>
  );
}
